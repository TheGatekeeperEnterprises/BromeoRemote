import { Alert } from "react-native";
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCRtpSender, MediaStream } from "react-native-webrtc";
import type { ChatMessage, ClipboardMessage, FileMessage, InputEvent, SystemCommand } from "./shared/protocol";
import { Signaling } from "./signaling";
import { getLicenseStatus } from "./license";

// Stays comfortably under the ~64KB/256KB SCTP message ceilings — same
// constant/value as client/src/renderer/session.ts's CHUNK_SIZE.
const CHUNK_SIZE = 48 * 1024;
// Shorter than the ~47s failure ceiling seen in practice (see docs/47seconds.md
// §4.9a) so the path gets refreshed well before whatever degrades it has a
// chance to accumulate — a single 30s interval let ~4 refreshes happen before
// still eventually failing, so refreshing more often is the next thing worth
// tuning. Kept identical to client/src/renderer/session.ts's constants.
const ICE_REFRESH_INTERVAL_MS = 15_000;
const DISCONNECTED_GRACE_MS = 20_000;
const DISCONNECT_RETRY_INTERVAL_MS = 4_000;

// VP8 (the usual default) has no tools for sharp text/UI edges — it's built
// for motion video. VP9 adds screen-content-coding (palette prediction,
// intra block copy) specifically for this kind of mostly-static, high-detail
// content, and should render text noticeably better at the same bitrate.
// Reordering (not filtering) preserves fallback to whatever the other side
// actually supports.
// "sharp" (default) ranks VP9 first for its screen-content-coding tools —
// but VP9 encoding in Chromium is effectively always software (no mature
// hardware encoder path the way H264 has via Windows Media Foundation),
// which under real load (native/4K capture, 60fps) can add real per-frame
// encode latency — reported as the video's own cursor feeling laggier than
// TeamViewer's, even with the local cursor overlay already removing most
// perceived lag elsewhere. "fast" ranks H264 first instead, trading some
// text sharpness for a real shot at hardware-accelerated encoding.
export type CodecPreferenceMode = "sharp" | "fast";
function preferScreenContentCodecs(codecs: { mimeType: string }[], mode: CodecPreferenceMode): { mimeType: string }[] {
  const rank = (mimeType: string): number => {
    const type = mimeType.toLowerCase();
    if (mode === "fast") {
      if (type.includes("h264")) return 0;
      if (type.includes("vp8")) return 1;
      if (type.includes("vp9")) return 2;
      return 3; // AV1 and anything else
    }
    if (type.includes("vp9")) return 0;
    if (type.includes("av1")) return 1;
    if (type.includes("h264")) return 2;
    return 3; // VP8 and anything else
  };
  return [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
}

function iceUrls(server: any): string[] {
  const urls = server?.urls;
  if (!urls) return [];
  return Array.isArray(urls) ? urls : [urls];
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
  // Fires when the *other* side's microphone track arrives on the
  // dedicated voice transceiver (see voiceTransceiver) — kept structurally
  // separate from onRemoteStream so it can never get mistaken for the
  // video+system-audio stream.
  onVoiceStream?(stream: MediaStream): void;
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
  private role: "host" | "viewer" | null = null;
  private candidateQueue: any[] = [];
  private pendingSystemCommands: SystemCommand[] = [];
  private incomingFiles = new Map<string, { name: string; total: number; chunks: string[]; received: number }>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private iceRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private licenseWarnTimer: ReturnType<typeof setTimeout> | null = null;
  private licenseLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectRetryTimer: ReturnType<typeof setInterval> | null = null;
  private iceRestartInFlight = false;
  private lastVideoBytes: number | null = null;
  private lastVideoBytesTimestamp: number | null = null;
  private lastMouseMoveSent = 0;
  private captureStream: MediaStream | null = null;
  // Bidirectional, always present from connect (see startAsViewer/
  // acceptAsHost) but silent until either side opts into voice intercom via
  // setMicrophoneTrack — pre-declaring it up front means turning the mic
  // on/off later is just replaceTrack, never a renegotiation. `any` to
  // match this file's established pattern for react-native-webrtc types.
  private voiceTransceiver: any = null;
  // See docs/47seconds.md — this is the mitigation for the mid-session
  // TURN-relay drop, not a fix for its root cause. It's genuinely active by
  // default (kept true here) since most users are better served by a
  // session that keeps quietly re-stitching itself than one that just
  // drops; setFailsafeEnabled lets a user turn it off from Settings if they
  // ever want to see a real disconnect instead of repeated background
  // reconnect attempts.
  private failsafeEnabled = true;
  private currentResolutionScale = 1;
  private sustainedHighRttTicks = 0;
  // Fase 1 commercial-use measurement (viewer side only — matches desktop's
  // client/src/renderer/session.ts). Set on connect, consumed and reported
  // on close; never affects the session.
  private connectedAt: number | null = null;
  constructor(private iceServers: any[], private signaling: Signaling, private peerId: string, private callbacks: SessionCallbacks) {
    console.log("[ice] configured ICE urls:", iceServers.flatMap(iceUrls), "policy=all");
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 10,
    });

    this.pc.addEventListener("icecandidate", (event: any) => {
      if (event.candidate) {
        console.log("[ice] local candidate:", event.candidate.type, event.candidate.protocol, event.candidate.candidate);
        this.signaling.send({ type: "signal", targetId: this.peerId, payload: { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate } });
      } else {
        console.log("[ice] gathering complete (null candidate)");
      }
    });
    this.pc.addEventListener("icegatheringstatechange", () => console.log("[ice] gatheringState:", this.pc.iceGatheringState));
    this.pc.addEventListener("iceconnectionstatechange", () => {
      console.log("[ice] iceConnectionState:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === "disconnected") this.dumpCandidatePairStats();
    });
    this.pc.addEventListener("icecandidateerror", (event: any) =>
      console.error("[ice] candidate error:", event.errorCode, event.errorText, event.url ?? event.address)
    );
    this.pc.addEventListener("connectionstatechange", () => {
      console.log("[ice] connectionState:", this.pc.connectionState);
      this.callbacks.onConnectionState?.(this.pc.connectionState);
      if (this.pc.connectionState === "connected") {
        this.clearDisconnectTimer();
        this.startStatsLoop();
        this.startIceRefreshLoop();
        if (this.role === "viewer") {
          this.enforceLicenseSessionLimit();
          this.connectedAt = Date.now();
        }
      } else if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "failed") {
        // Mirrors client/src/renderer/session.ts's fix — "failed" (never
        // reached "connected" at all) used to get zero retry attempts,
        // unlike a post-connect "disconnected" drop. See
        // docs/WEBRTC-TURN-DEBUGGING.md.
        this.stopStatsLoop();
        this.scheduleDisconnectRecovery();
      } else if (this.pc.connectionState === "closed") {
        this.clearDisconnectTimer();
        this.stopStatsLoop();
        this.stopIceRefreshLoop();
        this.clearLicenseTimers();
        this.reportCompletedSession();
      }
    });
    this.pc.addEventListener("track", (event: any) => {
      if (this.voiceTransceiver && event.transceiver === this.voiceTransceiver) {
        this.callbacks.onVoiceStream?.(event.streams?.[0] ?? new MediaStream([event.track]));
        return;
      }
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
  async startAsViewer(codecPreference: CodecPreferenceMode = "sharp"): Promise<void> {
    this.role = "viewer";
    const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
    try {
      const capabilities = RTCRtpSender.getCapabilities("video");
      if (capabilities?.codecs?.length) {
        videoTransceiver.setCodecPreferences(preferScreenContentCodecs(capabilities.codecs, codecPreference) as any);
      }
    } catch {
      // Not fatal — falls back to whatever codec order the platform negotiates by default.
    }
    this.pc.addTransceiver("audio", { direction: "recvonly" }); // host's system audio, one-way
    // Voice intercom — sendrecv from the start (see voiceTransceiver's own
    // comment), no track attached yet.
    this.voiceTransceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
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
    this.role = "host";
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
    // Identify the voice transceiver *after* addTrack above has filled
    // video + system-audio's senders (in that insertion order from
    // startAsViewer) — whichever transceiver's sender still has no track
    // is voice. Mirrors client/src/renderer/session.ts's acceptAsHost;
    // avoids relying on receiver.track's kind/timing, which react-native-
    // webrtc's own bridge doesn't reliably guarantee (this file's typed
    // `any` throughout for exactly that kind of typing/behavior gap).
    // mobile-as-host doesn't wire up sending its own voice in this phase,
    // but still needs the reference so an incoming viewer voice track is
    // routed to onVoiceStream instead of being mistaken for onRemoteStream.
    this.voiceTransceiver = this.pc.getTransceivers().find((t: any) => t.sender.track === null) ?? null;

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

  async answerOffer(offer: any): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushCandidateQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(new RTCSessionDescription(answer));
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: answer } });
  }

  hasCaptureStream(): boolean {
    return this.captureStream != null;
  }

  // Voice intercom on/off — swaps the sender's track on the pre-declared
  // sendrecv voice transceiver. No renegotiation needed. Pass null to stop
  // sending without tearing anything down.
  async setMicrophoneTrack(track: any): Promise<void> {
    await this.voiceTransceiver?.sender.replaceTrack(track);
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

        // Adaptive Quality Logic (host side only)
        if (this.role === "host") {
          const congested = rttMs != null && rttMs > 150;
          this.sustainedHighRttTicks = congested ? this.sustainedHighRttTicks + 1 : 0;
          const wantScale = this.sustainedHighRttTicks >= 3 ? 2 : 1; // scale down by half if high RTT for 3 ticks (6 seconds)
          if (wantScale !== this.currentResolutionScale) {
            this.currentResolutionScale = wantScale;
            const videoSender = this.pc.getSenders().find((s: any) => s.track?.kind === "video");
            if (videoSender) {
              try {
                const params = videoSender.getParameters();
                if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
                params.encodings[0].scaleResolutionDownBy = wantScale;
                await videoSender.setParameters(params);
                this.sendSystemCommand({ kind: "adaptive-status", resolutionScaled: wantScale > 1 });
              } catch {
                // best effort
              }
            }
          }
        }

        this.callbacks.onStats?.({ fps, bitrateKbps, rttMs, width, height });
      } catch {
        // stats collection is best-effort
      }
    }, 2000);
  }

  /** Settings-driven toggle for the periodic ICE-restart failsafe — see failsafeEnabled's own comment. */
  setFailsafeEnabled(enabled: boolean): void {
    this.failsafeEnabled = enabled;
    if (!enabled) this.stopIceRefreshLoop(); // stop an already-running proactive loop immediately
  }

  private startIceRefreshLoop(): void {
    if (this.role !== "viewer" || this.iceRefreshTimer || !this.failsafeEnabled) return;
    this.iceRefreshTimer = setInterval(() => {
      void this.restartIce("scheduled");
    }, ICE_REFRESH_INTERVAL_MS);
  }

  private stopIceRefreshLoop(): void {
    if (this.iceRefreshTimer) clearInterval(this.iceRefreshTimer);
    this.iceRefreshTimer = null;
    this.iceRestartInFlight = false;
  }

  private isRecoveringState(): boolean {
    return this.pc.connectionState === "disconnected" || this.pc.connectionState === "failed";
  }

  private scheduleDisconnectRecovery(): void {
    const reason = this.pc.connectionState === "failed" ? "failed" : "disconnected";
    if (this.role === "viewer" && this.failsafeEnabled) void this.restartIce(reason);
    // A single restart attempt can itself fail to land (e.g. it starts while
    // signalingState isn't stable yet, or its own candidate gather stalls) —
    // keep retrying every few seconds for the whole grace window instead of
    // trying once and just waiting out the clock. restartIce() already no-ops
    // safely if one is still in flight or the state isn't right for it.
    if (this.role === "viewer" && this.failsafeEnabled && !this.disconnectRetryTimer) {
      this.disconnectRetryTimer = setInterval(() => {
        if (this.isRecoveringState()) void this.restartIce(this.pc.connectionState === "failed" ? "failed" : "disconnected");
      }, DISCONNECT_RETRY_INTERVAL_MS);
    }
    // The grace-period close below always runs regardless of the failsafe
    // toggle — turning the active recovery attempts off shouldn't mean a
    // dead connection hangs forever, just that nothing actively fights to
    // revive it first.
    if (this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      this.clearDisconnectRetryTimer();
      if (this.isRecoveringState()) {
        console.warn(`[ice] ${this.pc.connectionState} recovery timed out, closing peer connection`);
        this.pc.close();
      }
    }, DISCONNECTED_GRACE_MS);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.clearDisconnectRetryTimer();
  }

  private clearDisconnectRetryTimer(): void {
    if (this.disconnectRetryTimer) clearInterval(this.disconnectRetryTimer);
    this.disconnectRetryTimer = null;
  }

  private async restartIce(reason: "scheduled" | "disconnected" | "failed"): Promise<void> {
    if (this.role !== "viewer" || this.iceRestartInFlight || this.pc.connectionState === "closed") return;
    if (this.pc.signalingState !== "stable") return;
    this.iceRestartInFlight = true;
    try {
      console.log(`[ice] restarting ICE (${reason})`);
      this.pc.restartIce?.();
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(new RTCSessionDescription(offer));
      this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: offer } });
    } catch (err) {
      console.warn("[ice] ICE restart failed:", err);
    } finally {
      this.iceRestartInFlight = false;
    }
  }

  // Temporary diagnostic for the ~40-47s mid-session drop investigation
  // (see docs/WEBRTC-TURN-DEBUGGING.md) — freeze-frames the selected
  // candidate pair and both its candidates the instant ICE first reports
  // "disconnected", to see which side stopped hearing from the other.
  private async dumpCandidatePairStats(): Promise<void> {
    try {
      const stats = await this.pc.getStats();
      const byId = new Map<string, any>();
      stats.forEach((report: any) => byId.set(report.id, report));
      stats.forEach((report: any) => {
        if (report.type === "candidate-pair" && (report.nominated || report.state === "succeeded")) {
          const local = byId.get(report.localCandidateId);
          const remote = byId.get(report.remoteCandidateId);
          console.warn("[ice] DROP DIAGNOSTIC candidate-pair:", JSON.stringify({
            state: report.state,
            nominated: report.nominated,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
            lastPacketSentTimestamp: report.lastPacketSentTimestamp,
            lastPacketReceivedTimestamp: report.lastPacketReceivedTimestamp,
            currentRoundTripTime: report.currentRoundTripTime,
            requestsSent: report.requestsSent,
            responsesReceived: report.responsesReceived,
            consentRequestsSent: report.consentRequestsSent,
          }));
          console.warn("[ice] DROP DIAGNOSTIC local candidate:", JSON.stringify({
            type: local?.candidateType,
            protocol: local?.protocol,
            relayProtocol: local?.relayProtocol,
            url: local?.url,
          }));
          console.warn("[ice] DROP DIAGNOSTIC remote candidate:", JSON.stringify({
            type: remote?.candidateType,
            protocol: remote?.protocol,
            relayProtocol: remote?.relayProtocol,
            url: remote?.url,
          }));
        }
      });
    } catch {
      // diagnostic only, never let this break the session
    }
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

  // Ported from client/src/renderer/session.ts's connected-state handler —
  // viewer-only (matches desktop), reads the cached license status (no
  // fresh network call here — the settings screen's verify button already
  // did that and cached the result) and, on the Free plan's default
  // sessionLimitMinutes, schedules a 1-minute warning and a hard close at
  // the limit. Unlike desktop's version, timers get explicitly cleared in
  // clearLicenseTimers()/close() below so a stale Alert can't fire after
  // the session already ended some other way.
  private enforceLicenseSessionLimit(): void {
    getLicenseStatus()
      .then((info) => {
        const sessionLimitMinutes = info.licenseStatus?.features?.sessionLimitMinutes ?? 15;
        if (!sessionLimitMinutes || sessionLimitMinutes <= 0) return;
        const ms = sessionLimitMinutes * 60 * 1000;
        console.log(`[License] Gratis sessielimiet geactiveerd: ${sessionLimitMinutes} minuten`);

        if (ms > 60_000) {
          this.licenseWarnTimer = setTimeout(() => {
            Alert.alert(
              "Sessie verloopt bijna",
              "Jouw gratis sessie verloopt over 1 minuut. Neem een Pro licentie op bromeoremote.com voor onbeperkte duur!"
            );
          }, ms - 60_000);
        }

        this.licenseLimitTimer = setTimeout(() => {
          Alert.alert(
            "Sessie beëindigd",
            `De gratis limiet van ${sessionLimitMinutes} minuten is bereikt. Neem een Pro licentie (€7,95/mnd) voor onbeperkte sessies.`
          );
          this.close();
        }, ms);
      })
      .catch(() => {});
  }

  private clearLicenseTimers(): void {
    if (this.licenseWarnTimer) clearTimeout(this.licenseWarnTimer);
    if (this.licenseLimitTimer) clearTimeout(this.licenseLimitTimer);
    this.licenseWarnTimer = null;
    this.licenseLimitTimer = null;
  }

  // Fase 1 commercial-use measurement — fire-and-forget, viewer side only,
  // one row per completed session (matches desktop's
  // client/src/renderer/session.ts reportCompletedSession). Never affects
  // the session; called from both the "closed" state branch and close()
  // since a locally-initiated close() isn't guaranteed to also dispatch a
  // "closed" connectionstatechange event.
  private reportCompletedSession(): void {
    if (this.role !== "viewer" || !this.connectedAt) return;
    const startedAt = this.connectedAt;
    this.connectedAt = null;
    getLicenseStatus()
      .then((info) => {
        if (!info.hwid) return;
        return fetch("https://bromeoremote.com/api/session/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: info.hwid,
            targetDeviceId: this.peerId,
            platform: "android",
            startedAt,
            endedAt: Date.now(),
            licenseKey: info.licenseKey || undefined,
            email: info.licenseEmail || undefined,
          }),
        });
      })
      .catch(() => {});
  }

  close(): void {
    this.clearDisconnectTimer();
    this.stopStatsLoop();
    this.stopIceRefreshLoop();
    this.clearLicenseTimers();
    this.reportCompletedSession();
    this.controlChannel?.close();
    this.clipboardChannel?.close();
    this.chatChannel?.close();
    this.systemChannel?.close();
    this.filesChannel?.close();
    this.captureStream?.getTracks().forEach((t: any) => t.stop());
    this.pc.close();
  }
}
