import type { ChatMessage, ClipboardMessage, FileMessage, InputEvent, SystemCommand } from "../shared/protocol.js";
import { Signaling } from "./signaling.js";

export type Role = "host" | "viewer";

// VP8 (the usual negotiated default) has no tools for sharp text/UI edges —
// it's built for motion video. VP9 adds screen-content-coding (palette
// prediction, intra block copy) specifically for mostly-static, high-detail
// content like a desktop share, and should render text noticeably better at
// the same bitrate. Reordering (not filtering) preserves fallback to
// whatever the other side actually supports.
function preferScreenContentCodecs<T extends { mimeType: string }>(codecs: T[]): T[] {
  const rank = (mimeType: string): number => {
    const type = mimeType.toLowerCase();
    if (type.includes("vp9")) return 0;
    if (type.includes("av1")) return 1;
    if (type.includes("h264")) return 2;
    return 3; // VP8 and anything else
  };
  return [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
}

function applyScreenContentCodecPreference(transceiver: RTCRtpTransceiver | undefined): void {
  if (!transceiver) return;
  try {
    const capabilities = RTCRtpSender.getCapabilities("video");
    if (capabilities?.codecs?.length) {
      transceiver.setCodecPreferences(preferScreenContentCodecs(capabilities.codecs));
    }
  } catch {
    // Not fatal — falls back to whatever codec order gets negotiated by default.
  }
}

export interface SessionStats {
  fps: number | null;
  bitrateKbps: number | null;
  rttMs: number | null;
}

export interface SessionCallbacks {
  onRemoteStream?(stream: MediaStream): void;
  onConnectionState?(state: RTCPeerConnectionState): void;
  onStats?(stats: SessionStats): void;
  onClipboard?(text: string): void;
  onChatMessage?(text: string, timestamp: number): void;
  onSystemCommand?(cmd: SystemCommand): void; // host side
  onInputEvent?(event: InputEvent): void; // host side
  onFileOffer?(offer: { id: string; name: string; size: number }): boolean | void;
  onFileProgress?(id: string, received: number, total: number): void;
  onFileComplete?(id: string, name: string, base64Chunks: string[]): void;
}

const CHUNK_SIZE = 48 * 1024; // stay comfortably under the ~64KB/256KB SCTP message ceilings

export class PeerSession {
  private pc: RTCPeerConnection;
  private controlChannel: RTCDataChannel | null = null;
  private filesChannel: RTCDataChannel | null = null;
  private clipboardChannel: RTCDataChannel | null = null;
  private chatChannel: RTCDataChannel | null = null;
  private systemChannel: RTCDataChannel | null = null;
  private captureStream: MediaStream | null = null;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private pendingSystemCommands: SystemCommand[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastVideoBytes: number | null = null;
  private lastVideoBytesTimestamp: number | null = null;
  private incomingFiles = new Map<string, { name: string; total: number; chunks: string[]; received: number }>();
  private lastMouseMoveSent = 0;

  constructor(
    private role: Role,
    private iceServers: RTCIceServer[],
    private signaling: Signaling,
    private peerId: string,
    private callbacks: SessionCallbacks
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.signaling.send({ type: "signal", targetId: this.peerId, payload: { candidate: ev.candidate.toJSON() } });
      }
    };
    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionState?.(this.pc.connectionState);
      if (this.pc.connectionState === "connected") this.startStatsLoop();
      if (["disconnected", "failed", "closed"].includes(this.pc.connectionState)) this.stopStatsLoop();
    };
    this.pc.ontrack = (ev) => {
      if (ev.streams[0]) this.callbacks.onRemoteStream?.(ev.streams[0]);
    };
    this.pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
  }

  private bindChannel(channel: RTCDataChannel): void {
    if (channel.label === "control") {
      this.controlChannel = channel;
      channel.onmessage = (ev) => {
        const event: InputEvent = JSON.parse(ev.data);
        this.callbacks.onInputEvent?.(event);
      };
    } else if (channel.label === "files") {
      this.filesChannel = channel;
      channel.onmessage = (ev) => this.handleFileMessage(JSON.parse(ev.data));
    } else if (channel.label === "clipboard") {
      this.clipboardChannel = channel;
      channel.onmessage = (ev) => {
        const msg: ClipboardMessage = JSON.parse(ev.data);
        this.callbacks.onClipboard?.(msg.text);
      };
    } else if (channel.label === "chat") {
      this.chatChannel = channel;
      channel.onmessage = (ev) => {
        const msg: ChatMessage = JSON.parse(ev.data);
        this.callbacks.onChatMessage?.(msg.text, msg.timestamp);
      };
    } else if (channel.label === "system") {
      this.systemChannel = channel;
      channel.onopen = () => this.flushPendingSystemCommands();
      channel.onmessage = (ev) => {
        const cmd: SystemCommand = JSON.parse(ev.data);
        this.callbacks.onSystemCommand?.(cmd);
      };
    }
  }

  /** Viewer: initiates the offer, requests a recvonly video transceiver, opens data channels. */
  async startAsViewer(): Promise<void> {
    const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
    applyScreenContentCodecPreference(videoTransceiver);
    this.pc.addTransceiver("audio", { direction: "recvonly" });
    this.bindChannel(this.pc.createDataChannel("control", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("files", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("clipboard", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("chat", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("system", { ordered: true }));

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: offer } });
  }

  /** Host: answers with the shared screen attached to the existing recvonly video transceiver. */
  async acceptAsHost(offer: RTCSessionDescriptionInit, captureStream: MediaStream): Promise<void> {
    await this.pc.setRemoteDescription(offer);
    await this.flushCandidateQueue();

    this.captureStream = captureStream;
    // Left unset, Chromium's encoder assumes this is ordinary motion video
    // (webcam-style) and targets a correspondingly modest bitrate — which
    // is almost certainly why screen shares were stuck at a pinned ~300kbps
    // even over a same-machine, 0ms-RTT loopback connection with plenty of
    // headroom. "detail" tells it this is static, text-heavy content that
    // should be encoded for spatial sharpness rather than smooth motion.
    const videoTrack = captureStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.contentHint = "detail";
    captureStream.getTracks().forEach((track) => this.pc.addTrack(track, captureStream));
    applyScreenContentCodecPreference(this.pc.getTransceivers().find((t) => t.sender.track?.kind === "video"));

    // Under bandwidth pressure, WebRTC's default ("balanced") sacrifices
    // both resolution and frame rate. For a screen share full of text,
    // blurry-but-smooth is worse than crisp-but-choppy — this tells the
    // encoder to hold resolution and drop frame rate instead when it has to
    // give something up. Set once here; it carries over through
    // replaceVideoTrack() since that reuses the same sender.
    const videoSender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (videoSender) {
      const params = videoSender.getParameters();
      params.degradationPreference = "maintain-resolution";
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      // Belt-and-braces alongside maintain-resolution above — some encoder
      // paths otherwise pick a scale-down factor of their own under
      // bandwidth pressure, which would blur exactly the fine detail that
      // "detail" contentHint and zooming are meant to preserve.
      params.encodings[0].scaleResolutionDownBy = 1;
      await videoSender.setParameters(params).catch(() => undefined);
    }

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: answer } });
  }

  /** Host: swaps in a newly captured monitor's track without renegotiating the connection. */
  async replaceVideoTrack(newStream: MediaStream): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    const newTrack = newStream.getVideoTracks()[0];
    if (!sender || !newTrack) return;
    newTrack.contentHint = "detail"; // see acceptAsHost — lost otherwise on every monitor switch
    const oldStream = this.captureStream;
    await sender.replaceTrack(newTrack);
    this.captureStream = newStream;
    oldStream?.getTracks().forEach((t) => t.stop());
  }

  /** Host: caps (or uncaps, when null) the outgoing video bitrate for the shared screen. */
  async setVideoBitrate(maxBitrateKbps: number | null): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrateKbps ? maxBitrateKbps * 1000 : undefined;
    await sender.setParameters(params);
  }

  /** Viewer: applies the host's answer once it arrives via signaling. */
  async applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    await this.flushCandidateQueue();
  }

  async addRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.candidateQueue.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  private async flushCandidateQueue(): Promise<void> {
    for (const c of this.candidateQueue.splice(0)) {
      await this.pc.addIceCandidate(c).catch(() => undefined);
    }
  }

  sendInput(event: InputEvent): void {
    if (this.controlChannel?.readyState !== "open") return;
    if (event.kind === "mousemove") {
      const now = performance.now();
      if (now - this.lastMouseMoveSent < 25) return; // ~40Hz cap, plenty for remote control
      this.lastMouseMoveSent = now;
    }
    this.controlChannel.send(JSON.stringify(event));
  }

  sendClipboard(text: string): void {
    if (this.clipboardChannel?.readyState === "open") {
      this.clipboardChannel.send(JSON.stringify({ kind: "clipboard", text } satisfies ClipboardMessage));
    }
  }

  sendChat(text: string): void {
    if (this.chatChannel?.readyState === "open") {
      this.chatChannel.send(JSON.stringify({ kind: "chat", text, timestamp: Date.now() } satisfies ChatMessage));
    }
  }

  sendSystemCommand(cmd: SystemCommand): void {
    if (this.systemChannel?.readyState === "open") {
      this.systemChannel.send(JSON.stringify(cmd));
      return;
    }
    this.pendingSystemCommands.push(cmd);
  }

  private flushPendingSystemCommands(): void {
    if (this.systemChannel?.readyState !== "open") return;
    for (const cmd of this.pendingSystemCommands.splice(0)) {
      this.systemChannel.send(JSON.stringify(cmd));
    }
  }

  async sendFile(name: string, base64: string): Promise<void> {
    if (this.filesChannel?.readyState !== "open") return;
    const id = crypto.randomUUID();
    const size = Math.ceil((base64.length * 3) / 4);
    const total = Math.ceil(base64.length / ((CHUNK_SIZE * 4) / 3));
    this.send(this.filesChannel, { kind: "file-offer", id, name, size });

    const chunkLen = Math.floor((CHUNK_SIZE * 4) / 3);
    for (let i = 0, idx = 0; i < base64.length; i += chunkLen, idx++) {
      const data = base64.slice(i, i + chunkLen);
      this.send(this.filesChannel, { kind: "file-chunk", id, index: idx, total, data });
      if (this.filesChannel.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 30)); // simple backpressure
      }
    }
    this.send(this.filesChannel, { kind: "file-done", id });
  }

  private send(channel: RTCDataChannel, msg: FileMessage): void {
    channel.send(JSON.stringify(msg));
  }

  private handleFileMessage(msg: FileMessage): void {
    if (msg.kind === "file-offer") {
      const accepted = this.callbacks.onFileOffer?.({ id: msg.id, name: msg.name, size: msg.size });
      if (accepted === false) return;
      this.incomingFiles.set(msg.id, { name: msg.name, total: msg.size, chunks: [], received: 0 });
    } else if (msg.kind === "file-chunk") {
      const entry = this.incomingFiles.get(msg.id);
      if (!entry) return;
      entry.chunks[msg.index] = msg.data;
      entry.received += msg.data.length;
      this.callbacks.onFileProgress?.(msg.id, entry.received, entry.total);
    } else if (msg.kind === "file-done") {
      const entry = this.incomingFiles.get(msg.id);
      if (!entry) return;
      this.callbacks.onFileComplete?.(msg.id, entry.name, entry.chunks);
      this.incomingFiles.delete(msg.id);
    }
  }

  private startStatsLoop(): void {
    this.stopStatsLoop();
    this.statsTimer = setInterval(async () => {
      const stats = await this.pc.getStats();
      let fps: number | null = null;
      let bitrateKbps: number | null = null;
      let rttMs: number | null = null;
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          if (typeof report.framesPerSecond === "number") fps = Math.round(report.framesPerSecond);
          bitrateKbps = this.computeVideoBitrate(report.bytesReceived, report.timestamp) ?? bitrateKbps;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          bitrateKbps = this.computeVideoBitrate(report.bytesSent, report.timestamp) ?? bitrateKbps;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
          if (typeof report.currentRoundTripTime === "number") rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
      });
      this.callbacks.onStats?.({ fps, bitrateKbps, rttMs });
    }, 2000);
  }

  // The candidate-pair's availableOutgoingBitrate is only the congestion
  // controller's bandwidth *estimate*, not what's actually being sent — it
  // can sit at its conservative startup value while the real encoded
  // bitrate is much higher. Derive the true rate from the byte counters
  // (outbound-rtp on the sender, inbound-rtp on the receiver) instead.
  private computeVideoBitrate(bytes: unknown, timestamp: unknown): number | null {
    if (typeof bytes !== "number" || typeof timestamp !== "number") return null;
    let result: number | null = null;
    if (this.lastVideoBytes != null && this.lastVideoBytesTimestamp != null) {
      const deltaBytes = bytes - this.lastVideoBytes;
      const deltaMs = timestamp - this.lastVideoBytesTimestamp;
      if (deltaMs > 0) result = Math.round((deltaBytes * 8) / deltaMs);
    }
    this.lastVideoBytes = bytes;
    this.lastVideoBytesTimestamp = timestamp;
    return result;
  }

  private stopStatsLoop(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.lastVideoBytes = null;
    this.lastVideoBytesTimestamp = null;
  }

  close(): void {
    this.stopStatsLoop();
    this.pendingSystemCommands = [];
    this.controlChannel?.close();
    this.filesChannel?.close();
    this.clipboardChannel?.close();
    this.chatChannel?.close();
    this.systemChannel?.close();
    this.captureStream?.getTracks().forEach((t) => t.stop());
    this.pc.close();
  }
}
