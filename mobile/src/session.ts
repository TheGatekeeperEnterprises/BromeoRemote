import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCRtpSender, MediaStream } from "react-native-webrtc";
import type { ChatMessage, ClipboardMessage, FileMessage, InputEvent, SystemCommand } from "./shared/protocol";
import { Signaling } from "./signaling";

// Stays comfortably under the ~64KB/256KB SCTP message ceilings — same
// constant/value as client/src/renderer/session.ts's CHUNK_SIZE.
const CHUNK_SIZE = 48 * 1024;

// VP8 (the usual default) has no tools for sharp text/UI edges — it's built
// for motion video. VP9 adds screen-content-coding (palette prediction,
// intra block copy) specifically for this kind of mostly-static, high-detail
// content, and should render text noticeably better at the same bitrate.
// Reordering (not filtering) preserves fallback to whatever the other side
// actually supports.
function preferScreenContentCodecs(codecs: { mimeType: string }[]): { mimeType: string }[] {
  const rank = (mimeType: string): number => {
    const type = mimeType.toLowerCase();
    if (type.includes("vp9")) return 0;
    if (type.includes("av1")) return 1;
    if (type.includes("h264")) return 2;
    return 3; // VP8 and anything else
  };
  return [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
}

export interface SessionStats {
  fps: number | null;
  bitrateKbps: number | null;
  rttMs: number | null;
  width: number | null;
  height: number | null;
}

export interface SessionCallbacks {
  onRemoteStream?(stream: MediaStream): void;
  onConnectionState?(state: string): void;
  onStats?(stats: SessionStats): void;
  onClipboard?(text: string): void;
  onChatMessage?(text: string, timestamp: number): void;
  onSystemCommand?(cmd: SystemCommand): void;
  onInputEvent?(event: InputEvent): void; // host role only
  onFileOffer?(offer: { id: string; name: string; size: number }): void;
  onFileProgress?(id: string, received: number, total: number): void;
  onFileComplete?(id: string, name: string, base64Chunks: string[]): void;
}

export class MobileSession {
  // react-native-webrtc's shipped .d.ts doesn't surface the addEventListener
  // overloads its own EventTarget base class provides at runtime — typed as
  // `any` here rather than fighting a third-party typing gap.
  private pc: any;
  private controlChannel: any = null;
  private clipboardChannel: any = null;
  private chatChannel: any = null;
  private systemChannel: any = null;
  private filesChannel: any = null;
  private candidateQueue: any[] = [];
  private pendingSystemCommands: SystemCommand[] = [];
  private incomingFiles = new Map<string, { name: string; total: number; chunks: string[]; received: number }>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastVideoBytes: number | null = null;
  private lastVideoBytesTimestamp: number | null = null;
  private lastMouseMoveSent = 0;
  private captureStream: MediaStream | null = null;

  constructor(private iceServers: any[], private signaling: Signaling, private peerId: string, private callbacks: SessionCallbacks) {
    this.pc = new RTCPeerConnection({ iceServers });

    this.pc.addEventListener("icecandidate", (event: any) => {
      if (event.candidate) {
        this.signaling.send({ type: "signal", targetId: this.peerId, payload: { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate } });
      }
    });
    this.pc.addEventListener("connectionstatechange", () => {
      this.callbacks.onConnectionState?.(this.pc.connectionState);
      if (this.pc.connectionState === "connected") this.startStatsLoop();
      if (["disconnected", "failed", "closed"].includes(this.pc.connectionState)) this.stopStatsLoop();
    });
    this.pc.addEventListener("track", (event: any) => {
      if (event.streams && event.streams[0]) this.callbacks.onRemoteStream?.(event.streams[0]);
    });
    this.pc.addEventListener("datachannel", (event: any) => this.bindChannel(event.channel));
  }

  private bindChannel(channel: any): void {
    if (channel.label === "control") {
      this.controlChannel = channel;
      // Only meaningful on the host side (a viewer only ever sends on this
      // channel) — harmless no-op via the optional callback otherwise.
      channel.addEventListener("message", (ev: any) => {
        const event: InputEvent = JSON.parse(ev.data);
        this.callbacks.onInputEvent?.(event);
      });
    } else if (channel.label === "clipboard") {
      this.clipboardChannel = channel;
      channel.addEventListener("message", (ev: any) => {
        const msg: ClipboardMessage = JSON.parse(ev.data);
        this.callbacks.onClipboard?.(msg.text);
      });
    } else if (channel.label === "chat") {
      this.chatChannel = channel;
      channel.addEventListener("message", (ev: any) => {
        const msg: ChatMessage = JSON.parse(ev.data);
        this.callbacks.onChatMessage?.(msg.text, msg.timestamp);
      });
    } else if (channel.label === "system") {
      this.systemChannel = channel;
      channel.addEventListener("open", () => this.flushPendingSystemCommands());
      channel.addEventListener("message", (ev: any) => {
        const cmd: SystemCommand = JSON.parse(ev.data);
        this.callbacks.onSystemCommand?.(cmd);
      });
    } else if (channel.label === "files") {
      this.filesChannel = channel;
      channel.addEventListener("message", (ev: any) => this.handleFileMessage(JSON.parse(ev.data)));
    }
  }

  /** Initiates the offer, requests recvonly video/audio transceivers, opens data channels. */
  async startAsViewer(): Promise<void> {
    const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
    try {
      const capabilities = RTCRtpSender.getCapabilities("video");
      if (capabilities?.codecs?.length) {
        videoTransceiver.setCodecPreferences(preferScreenContentCodecs(capabilities.codecs) as any);
      }
    } catch {
      // Not fatal — falls back to whatever codec order the platform negotiates by default.
    }
    this.pc.addTransceiver("audio", { direction: "recvonly" });
    this.bindChannel(this.pc.createDataChannel("control", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("clipboard", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("chat", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("system", { ordered: true }));
    this.bindChannel(this.pc.createDataChannel("files", { ordered: true }));

    const offer = await this.pc.createOffer({});
    await this.pc.setLocalDescription(new RTCSessionDescription(offer));
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: offer } });
  }

  /** Host: answers with the phone's shared screen (MediaProjection, video-only —
   * react-native-webrtc's getDisplayMedia() doesn't capture audio) attached to
   * the viewer's existing recvonly video transceiver. Mirrors
   * client/src/renderer/session.ts's acceptAsHost. */
  async acceptAsHost(offer: any, captureStream: MediaStream): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushCandidateQueue();

    this.captureStream = captureStream;
    // Left unset, the encoder assumes ordinary motion video (webcam-style)
    // and targets a correspondingly modest bitrate. "detail" tells it this
    // is static, text-heavy screen content that should be encoded for
    // spatial sharpness rather than smooth motion. Best-effort — contentHint
    // support varies by react-native-webrtc version.
    const videoTrack = captureStream.getVideoTracks()[0] as any;
    if (videoTrack) {
      try {
        videoTrack.contentHint = "detail";
      } catch {
        // Not fatal — falls back to the default (motion-tuned) behavior.
      }
    }
    captureStream.getTracks().forEach((track: any) => this.pc.addTrack(track, captureStream));

    // Best-effort — react-native-webrtc's setParameters support varies by
    // version. Mirrors client/src/renderer/session.ts's acceptAsHost: under
    // bandwidth pressure, hold resolution and drop frame rate instead of
    // WebRTC's default of degrading both.
    const videoSender = this.pc.getSenders().find((s: any) => s.track?.kind === "video");
    if (videoSender) {
      try {
        const params = videoSender.getParameters();
        params.degradationPreference = "maintain-resolution";
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].scaleResolutionDownBy = 1;
        await videoSender.setParameters(params);
      } catch {
        // Not fatal — falls back to the default degradation behavior.
      }
    }

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(new RTCSessionDescription(answer));
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: answer } });
  }

  async applyAnswer(answer: any): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushCandidateQueue();
  }

  async addRemoteCandidate(candidate: any): Promise<void> {
    if (!this.pc.remoteDescription) {
      this.candidateQueue.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private async flushCandidateQueue(): Promise<void> {
    for (const c of this.candidateQueue.splice(0)) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
    }
  }

  sendInput(event: InputEvent): void {
    if (!this.controlChannel || this.controlChannel.readyState !== "open") return;
    if (event.kind === "mousemove") {
      const now = Date.now();
      if (now - this.lastMouseMoveSent < 25) return;
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

  // Queues rather than silently dropping when called before the data
  // channel opens (e.g. the "restore last quality setting" call right after
  // startAsViewer(), well before the WebRTC handshake completes).
  sendSystemCommand(cmd: SystemCommand): void {
    if (this.systemChannel?.readyState === "open") {
      this.systemChannel.send(JSON.stringify(cmd));
    } else {
      this.pendingSystemCommands.push(cmd);
    }
  }

  private flushPendingSystemCommands(): void {
    for (const cmd of this.pendingSystemCommands.splice(0)) {
      this.systemChannel.send(JSON.stringify(cmd));
    }
  }

  // No accept/decline handshake before sending — mirrors
  // client/src/renderer/session.ts's sendFile, which starts streaming chunks
  // right after the offer. The session-level connect accept/decline dialog
  // is treated as sufficient consent for transfers during that session.
  async sendFile(name: string, base64: string): Promise<void> {
    if (this.filesChannel?.readyState !== "open") return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const size = Math.ceil((base64.length * 3) / 4);
    const total = Math.ceil(base64.length / ((CHUNK_SIZE * 4) / 3));
    this.send({ kind: "file-offer", id, name, size });

    const chunkLen = Math.floor((CHUNK_SIZE * 4) / 3);
    for (let i = 0, idx = 0; i < base64.length; i += chunkLen, idx++) {
      const data = base64.slice(i, i + chunkLen);
      this.send({ kind: "file-chunk", id, index: idx, total, data });
      if (this.filesChannel.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 30)); // simple backpressure
      }
    }
    this.send({ kind: "file-done", id });
  }

  private send(msg: FileMessage): void {
    this.filesChannel.send(JSON.stringify(msg));
  }

  private handleFileMessage(msg: FileMessage): void {
    if (msg.kind === "file-offer") {
      this.callbacks.onFileOffer?.({ id: msg.id, name: msg.name, size: msg.size });
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
      try {
        const stats = await this.pc.getStats();
        let fps: number | null = null;
        let bitrateKbps: number | null = null;
        let rttMs: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        stats.forEach((report: any) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            if (typeof report.framesPerSecond === "number") fps = Math.round(report.framesPerSecond);
            if (typeof report.frameWidth === "number") width = report.frameWidth;
            if (typeof report.frameHeight === "number") height = report.frameHeight;
            bitrateKbps = this.computeVideoBitrate(report.bytesReceived, report.timestamp) ?? bitrateKbps;
          }
          if (report.type === "outbound-rtp" && report.kind === "video") {
            bitrateKbps = this.computeVideoBitrate(report.bytesSent, report.timestamp) ?? bitrateKbps;
          }
          if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
            if (typeof report.currentRoundTripTime === "number") rttMs = Math.round(report.currentRoundTripTime * 1000);
          }
        });
        this.callbacks.onStats?.({ fps, bitrateKbps, rttMs, width, height });
      } catch {
        // stats collection is best-effort
      }
    }, 2000);
  }

  // candidate-pair's availableOutgoingBitrate is only the congestion
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
    this.controlChannel?.close();
    this.clipboardChannel?.close();
    this.chatChannel?.close();
    this.systemChannel?.close();
    this.filesChannel?.close();
    this.captureStream?.getTracks().forEach((t: any) => t.stop());
    this.pc.close();
  }
}
