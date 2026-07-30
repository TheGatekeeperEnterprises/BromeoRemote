import type { ChatMessage, ClipboardMessage, FileMessage, InputEvent, SystemCommand } from "../shared/protocol.js";
import { Signaling } from "./signaling.js";

export type Role = "host" | "viewer";

// "sharp" (default): VP8 has no tools for sharp text/UI edges — it's built
// for motion video. VP9 adds screen-content-coding (palette prediction,
// intra block copy) specifically for mostly-static, high-detail content
// like a desktop share, and should render text noticeably better at the
// same bitrate. But VP9 encoding in Chromium is effectively always
// software (no mature hardware encoder path the way H264 has via Windows
// Media Foundation) — under real load (native/4K capture, 60fps) that can
// add real per-frame encode latency, felt as the video's own cursor
// lagging. "fast" ranks H264 first instead, trading some text sharpness
// for a real shot at hardware-accelerated encoding. Reordering (not
// filtering) preserves fallback to whatever the other side actually
// supports either way.
export type CodecPreferenceMode = "sharp" | "fast";
function preferScreenContentCodecs<T extends { mimeType: string }>(codecs: T[], mode: CodecPreferenceMode): T[] {
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

function applyScreenContentCodecPreference(transceiver: RTCRtpTransceiver | undefined, mode: CodecPreferenceMode = "sharp"): void {
  if (!transceiver) return;
  try {
    const capabilities = RTCRtpSender.getCapabilities("video");
    if (capabilities?.codecs?.length) {
      transceiver.setCodecPreferences(preferScreenContentCodecs(capabilities.codecs, mode));
    }
  } catch {
    // Not fatal — falls back to whatever codec order gets negotiated by default.
  }
}

function iceUrls(server: RTCIceServer): string[] {
  const urls = server.urls;
  if (!urls) return [];
  return Array.isArray(urls) ? urls : [urls];
}

export interface SessionStats {
  fps: number | null;
  bitrateKbps: number | null;
  rttMs: number | null;
}

export interface SessionCallbacks {
  onRemoteStream?(stream: MediaStream): void;
  // Fires when the *other* side's microphone track arrives on the
  // dedicated voice transceiver (see voiceTransceiver) — kept structurally
  // separate from onRemoteStream so an incoming voice-only stream can never
  // get mistaken for the video+system-audio stream and attached to the
  // wrong <video>/<audio> element.
  onVoiceStream?(stream: MediaStream): void;
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
// Brief grace window before a "disconnected"/"failed" state is treated as
// truly dead — gives a momentary blip a chance to self-heal via the
// browser's own native ICE consent-freshness checks, without this app
// actively attempting any recovery itself.
const DISCONNECTED_GRACE_MS = 20_000;

// Adaptive bitrate ("auto" quality) tuning. Below MIN, text stops being
// legible no matter what; above MAX there's no visible benefit and it's just
// wasted bandwidth (matches the existing "low"/"high" manual tiers' bounds,
// so switching between manual and auto never jumps outside a range the user
// has already seen). HEADROOM keeps the target under the browser's own
// bandwidth estimate rather than chasing it exactly, so the encoder isn't
// the thing that pushes the link into congestion in the first place.
const ADAPTIVE_MIN_KBPS = 500;
const ADAPTIVE_MAX_KBPS = 20000;
const ADAPTIVE_HEADROOM = 0.85;
// While the viewer is actively zoomed in (see setZoomedIn), the user is
// scrutinizing detail right now — worth spending closer to the full
// estimated bandwidth (less safety margin) and never dropping below a
// legible floor, even if that risks tolerating a bit more congestion than
// usual. Reverts to the normal headroom/floor the moment they zoom back out.
const ADAPTIVE_ZOOM_HEADROOM = 0.97;
const ADAPTIVE_ZOOM_MIN_KBPS = 2500;
// Last resort: acceptAsHost pins scaleResolutionDownBy at 1 (see its own
// comment) so bitrate pressure degrades frame rate, not sharpness — right
// up until the cap has been pinned at its own floor under real congestion
// for a while, at which point full resolution at a floor-level bitrate is
// just a blocky mess anyway. Scaling the encode down trades resolution for
// a bitrate-per-pixel ratio that actually looks clean, the same trade a
// human would make manually. SUSTAINED_TICKS requires several consecutive
// congested-at-floor stats ticks (not one blip) before committing to it,
// since resizing the encoder's internal buffers isn't free and shouldn't
// flip back and forth on noise.
const ADAPTIVE_RESOLUTION_SCALE_DOWN = 1.5;
const ADAPTIVE_SUSTAINED_FLOOR_TICKS = 3;
// Fast-down/slow-up: congestion should be shed immediately (a full jump to
// target in one tick), while recovery ramps gradually so a momentarily
// optimistic bandwidth estimate can't immediately shove the link right back
// into the congestion it just recovered from.
const ADAPTIVE_RAMP_UP_STEP = 0.15;
const ADAPTIVE_PACKET_LOSS_CONGESTED = 0.05;
// Below this, two estimates are treated as "the same" and skipped — every
// tick's estimate jitters a little even on a stable link, and re-issuing
// setParameters for noise alone would churn the encoder for no visible gain.
const ADAPTIVE_MIN_CHANGE_FRACTION = 0.03;

export class PeerSession {
  private pc: RTCPeerConnection;
  private controlChannel: RTCDataChannel | null = null;
  private filesChannel: RTCDataChannel | null = null;
  private clipboardChannel: RTCDataChannel | null = null;
  private chatChannel: RTCDataChannel | null = null;
  private systemChannel: RTCDataChannel | null = null;
  private captureStream: MediaStream | null = null;
  // Bidirectional, always present from connect (see startAsViewer/
  // acceptAsHost) but silent (no attached track) until either side opts
  // into voice intercom via setMicrophoneTrack — pre-declaring it up front
  // means turning the mic on/off later is just replaceTrack, never a
  // renegotiation.
  private voiceTransceiver: RTCRtpTransceiver | null = null;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private pendingSystemCommands: SystemCommand[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastVideoBytes: number | null = null;
  private lastVideoBytesTimestamp: number | null = null;
  private incomingFiles = new Map<string, { name: string; total: number; chunks: string[]; received: number }>();
  private lastMouseMoveSent = 0;
  // "auto" quality (the default) drives the bitrate cap continuously off
  // real measured conditions instead of leaving it permanently uncapped —
  // see updateAdaptiveBitrate. Manual "high"/"low" picks disable this.
  private adaptiveQualityEnabled = true;
  private currentAdaptiveCapKbps: number | null = null;
  private viewerZoomedIn = false;
  private currentResolutionScale = 1;
  private sustainedFloorTicks = 0;
  private lastSentLimitationReason: string | null | undefined = undefined; // undefined = never sent yet
  // Fase 1 commercial-use measurement (viewer side only — the account/license
  // lives on the operator, not the host-being-helped device). Set on connect,
  // consumed and reported on close; never affects the session itself.
  private connectedAt: number | null = null;

  constructor(
    private role: Role,
    private iceServers: RTCIceServer[],
    private signaling: Signaling,
    private peerId: string,
    private callbacks: SessionCallbacks
  ) {
    console.log("[ice] configured ICE urls:", iceServers.flatMap(iceUrls), "policy=all");
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      // Pooled pre-gathering was added for mobile's 4G-hotspot connect speed
      // (see git history) and mobile's WebRTC engine has never shown any
      // TURN-gathering trouble. Desktop's Chromium, on this machine at
      // least, has a confirmed-broken TURN relay/response handling path
      // (see docs/WEBRTC-TURN-DEBUGGING.md) that was never verified against
      // eagerly gathering a pool of candidates at construction time, before
      // the offer/role is even known — removed here as an untested variable
      // while chasing that bug, not because pooling itself is known-bad.
    });
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        console.log("[ice] local candidate:", ev.candidate.type, ev.candidate.protocol, ev.candidate.candidate);
        this.signaling.send({ type: "signal", targetId: this.peerId, payload: { candidate: ev.candidate.toJSON() } });
      } else {
        console.log("[ice] gathering complete (null candidate)");
      }
    };
    this.pc.onicegatheringstatechange = () => console.log("[ice] gatheringState:", this.pc.iceGatheringState);
    this.pc.oniceconnectionstatechange = () => {
      console.log("[ice] iceConnectionState:", this.pc.iceConnectionState);
      if (this.pc.iceConnectionState === "disconnected") this.dumpCandidatePairStats();
    };
    this.pc.onicecandidateerror = (ev: any) =>
      console.error("[ice] candidate error:", ev.errorCode, ev.errorText, ev.url ?? ev.address);
    this.pc.onconnectionstatechange = () => {
      console.log("[ice] connectionState:", this.pc.connectionState);
      this.callbacks.onConnectionState?.(this.pc.connectionState);
      if (this.pc.connectionState === "connected") {
        this.clearDisconnectTimer();
        this.startStatsLoop();

        if (this.role === "viewer") this.connectedAt = Date.now();

        if ((window as any).bromeo?.getLicenseStatus) {
          (window as any).bromeo.getLicenseStatus().then((status: any) => {
            // features.sessionLimitMinutes is `null` (not absent) for a
            // paid Pro/Unlimited plan — that's the server's explicit "no
            // limit" signal (see website/src/database.js's verifyLicenseInDb),
            // so `?? 15` here would silently reapply the free-tier cap to
            // every paying account. Only a real number ever schedules a
            // limit; missing/null both mean "don't enforce one".
            const sessionLimitMinutes = status?.licenseStatus?.features?.sessionLimitMinutes;
            if (typeof sessionLimitMinutes === "number" && sessionLimitMinutes > 0) {
              const ms = sessionLimitMinutes * 60 * 1000;
              console.log(`[License] Gratis sessielimiet geactiveerd: ${sessionLimitMinutes} minuten`);

              if (ms > 60000) {
                setTimeout(() => {
                  alert(`Let op: Jouw gratis sessie verloopt over 1 minuut. Neem een Pro licentie op bromeoremote.com voor onbeperkte duur!`);
                }, ms - 60000);
              }

              setTimeout(() => {
                alert(`Sessie beëindigd: De gratis limiet van ${sessionLimitMinutes} minuten is bereikt. Neem een Pro licentie (€7,95/mnd) voor onbeperkte sessies.`);
                this.close();
              }, ms);
            }
          }).catch(() => {});
        }
      } else if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "failed") {
        this.stopStatsLoop();
        this.scheduleDisconnectClose();
      } else if (this.pc.connectionState === "closed") {
        this.clearDisconnectTimer();
        this.stopStatsLoop();
        this.reportCompletedSession();
      }
    };
    this.pc.ontrack = (ev) => {
      if (this.voiceTransceiver && ev.transceiver === this.voiceTransceiver) {
        this.callbacks.onVoiceStream?.(ev.streams[0] ?? new MediaStream([ev.track]));
        return;
      }
      if (ev.streams[0]) this.callbacks.onRemoteStream?.(ev.streams[0]);
    };
    this.pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
  }

  // Fase 1 commercial-use measurement — fire-and-forget, viewer side only,
  // one row per completed session (avoids needing to correlate separate
  // connect/disconnect events server-side). Never affects the session.
  private reportCompletedSession(): void {
    if (this.role !== "viewer" || !this.connectedAt) return;
    const startedAt = this.connectedAt;
    this.connectedAt = null;
    if (!(window as any).bromeo?.reportSession || !(window as any).bromeo?.getConfig) return;
    void (window as any).bromeo
      .getConfig()
      .then((cfg: any) => {
        if (!cfg?.deviceId) return;
        return (window as any).bromeo.reportSession({
          deviceId: cfg.deviceId,
          targetDeviceId: this.peerId,
          platform: "windows",
          startedAt,
          endedAt: Date.now(),
        });
      })
      .catch(() => {});
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
  async startAsViewer(codecPreference: CodecPreferenceMode = "sharp"): Promise<void> {
    const videoTransceiver = this.pc.addTransceiver("video", { direction: "recvonly" });
    applyScreenContentCodecPreference(videoTransceiver, codecPreference);
    this.pc.addTransceiver("audio", { direction: "recvonly" }); // host's system audio, one-way
    // Voice intercom — sendrecv from the start (see voiceTransceiver's own
    // comment), no track attached yet.
    this.voiceTransceiver = this.pc.addTransceiver("audio", { direction: "sendrecv" });
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
    // addTrack — not explicit per-transceiver replaceTrack — deliberately:
    // this is the exact mechanism proven reliable for this whole project
    // before voice intercom added a second audio transceiver. Its
    // insertion-order-based "first transceiver whose sender has no track
    // yet" matching is a foundational, well-specified part of addTrack
    // (unlike relying on RTCRtpReceiver.track's kind/timing, which isn't
    // something this could be verified live before shipping — see the plan
    // doc's own callout on this). video and system-audio were both
    // addTransceiver'd before voice in startAsViewer, so they're filled
    // first, in that order, leaving voice's sender the only one still
    // empty afterward.
    captureStream.getTracks().forEach((track) => this.pc.addTrack(track, captureStream));
    const videoTransceiver = this.pc.getTransceivers().find((t) => t.sender.track?.kind === "video");
    this.voiceTransceiver = this.pc.getTransceivers().find((t) => t.sender.track === null) ?? null;
    applyScreenContentCodecPreference(videoTransceiver);

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

  /** Host: answers a renegotiation/ICE-restart offer without asking for screen capture again. */
  async answerOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(offer);
    await this.flushCandidateQueue();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.send({ type: "signal", targetId: this.peerId, payload: { sdp: answer } });
  }

  hasCaptureStream(): boolean {
    return this.captureStream != null;
  }

  // Voice intercom on/off — swaps the sender's track on the pre-declared
  // sendrecv voice transceiver (see its own comment). No renegotiation:
  // that transceiver already exists from connect, this just changes what
  // it transmits, same replaceTrack mechanism as replaceVideoTrack. Pass
  // null to stop sending (mic muted/off) without tearing anything down.
  async setMicrophoneTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.voiceTransceiver?.sender.replaceTrack(track);
  }

  // Host: swaps in a newly captured monitor's track without renegotiating
  // the connection. Deliberately does NOT stop the old stream's tracks —
  // with multi-viewer hosting the same "old" stream may still be attached to
  // other PeerSessions that haven't swapped yet. The caller (app.ts) is
  // responsible for stopping a stream's tracks once nothing references it
  // anymore, after looping this over every connected viewer.
  async replaceVideoTrack(newStream: MediaStream): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    const newTrack = newStream.getVideoTracks()[0];
    if (!sender || !newTrack) return;
    newTrack.contentHint = "detail"; // see acceptAsHost — lost otherwise on every monitor switch
    await sender.replaceTrack(newTrack);
    this.captureStream = newStream;
  }

  /** Host: caps (or uncaps, when null) the outgoing video bitrate for the shared screen. */
  async setVideoBitrate(maxBitrateKbps: number | null): Promise<void> {
    await this.applyBitrateCap(maxBitrateKbps);
  }

  private async applyBitrateCap(maxBitrateKbps: number | null): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrateKbps ? maxBitrateKbps * 1000 : undefined;
    await sender.setParameters(params).catch(() => undefined);
  }

  /** Host: toggles the continuous network-adaptive bitrate engine ("auto" quality) on or off. */
  setAdaptiveQuality(enabled: boolean): void {
    this.adaptiveQualityEnabled = enabled;
    if (!enabled) {
      this.currentAdaptiveCapKbps = null; // don't reuse a stale ramp state on the next "auto" pick
      this.sustainedFloorTicks = 0;
      if (this.currentResolutionScale !== 1) {
        this.currentResolutionScale = 1;
        void this.applyResolutionScale(1); // manual "high"/"low" are always full resolution
        this.sendSystemCommand({ kind: "adaptive-status", resolutionScaled: false });
      }
    }
  }

  /** Host: whether the viewer is currently zoomed in — see ADAPTIVE_ZOOM_HEADROOM. */
  setZoomedIn(zoomedIn: boolean): void {
    this.viewerZoomedIn = zoomedIn;
  }

  /** Viewer: applies the host's answer once it arrives via signaling. */
  async applyAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(answer);
    await this.flushCandidateQueue();
  }

  async addRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate || !candidate.candidate) return;
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      this.candidateQueue.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn("[ice] error adding remote candidate:", e);
    }
  }

  private async flushCandidateQueue(): Promise<void> {
    const queue = this.candidateQueue.splice(0);
    for (const c of queue) {
      if (!c || !c.candidate) continue;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn("[ice] error flushing candidate:", e);
      }
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
      let availableOutgoingBps: number | null = null;
      let qualityLimitationReason: string | null = null;
      let fractionLost: number | null = null;
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          if (typeof report.framesPerSecond === "number") fps = Math.round(report.framesPerSecond);
          bitrateKbps = this.computeVideoBitrate(report.bytesReceived, report.timestamp) ?? bitrateKbps;
        }
        if (report.type === "outbound-rtp" && report.kind === "video") {
          bitrateKbps = this.computeVideoBitrate(report.bytesSent, report.timestamp) ?? bitrateKbps;
          if (typeof report.qualityLimitationReason === "string") qualityLimitationReason = report.qualityLimitationReason;
        }
        if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          if (typeof report.fractionLost === "number") fractionLost = report.fractionLost;
        }
        if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
          if (typeof report.currentRoundTripTime === "number") rttMs = Math.round(report.currentRoundTripTime * 1000);
          if (typeof report.availableOutgoingBitrate === "number") availableOutgoingBps = report.availableOutgoingBitrate;
        }
      });
      this.callbacks.onStats?.({ fps, bitrateKbps, rttMs });
      if (this.role === "host") {
        // Diagnostic-only — the viewer has no way to read this itself (see
        // "encoder-limitation" in shared/protocol.ts). Deduped so it's only
        // sent when it actually changes, not every 2s tick.
        if (qualityLimitationReason !== this.lastSentLimitationReason) {
          this.lastSentLimitationReason = qualityLimitationReason;
          this.sendSystemCommand({ kind: "encoder-limitation", reason: qualityLimitationReason });
        }
        if (this.adaptiveQualityEnabled) {
          await this.updateAdaptiveBitrate(availableOutgoingBps, qualityLimitationReason, fractionLost);
        }
      }
    }, 2000);
  }

  // Real congestion-aware bitrate control for "auto" quality, instead of
  // "auto" just meaning permanently uncapped. availableOutgoingBitrate is
  // Chromium's own send-side bandwidth estimate (from RTCP/TWCC feedback,
  // works the same whether the path is direct or TURN-relayed); combined
  // with qualityLimitationReason/fractionLost as a "this isn't just a
  // conservative estimate, it's actually congested right now" signal for
  // reacting faster than the gradual ramp would on its own.
  private async updateAdaptiveBitrate(
    availableOutgoingBps: number | null,
    qualityLimitationReason: string | null,
    fractionLost: number | null
  ): Promise<void> {
    if (availableOutgoingBps == null) return; // no estimate yet this tick — leave the current cap alone
    const estimateKbps = availableOutgoingBps / 1000;
    const headroom = this.viewerZoomedIn ? ADAPTIVE_ZOOM_HEADROOM : ADAPTIVE_HEADROOM;
    const minKbps = this.viewerZoomedIn ? ADAPTIVE_ZOOM_MIN_KBPS : ADAPTIVE_MIN_KBPS;
    const targetKbps = Math.min(ADAPTIVE_MAX_KBPS, Math.max(minKbps, estimateKbps * headroom));
    const current = this.currentAdaptiveCapKbps ?? targetKbps;

    const congested =
      qualityLimitationReason === "bandwidth" || (fractionLost != null && fractionLost > ADAPTIVE_PACKET_LOSS_CONGESTED);
    let nextKbps: number;
    if (targetKbps < current || congested) {
      nextKbps = targetKbps; // shed congestion immediately, no gradual ramp down
    } else {
      nextKbps = current + Math.min(targetKbps - current, current * ADAPTIVE_RAMP_UP_STEP); // recover cautiously
    }
    nextKbps = Math.round(Math.min(ADAPTIVE_MAX_KBPS, Math.max(minKbps, nextKbps)));

    // Pinned at (or essentially at) the floor while still congested — not a
    // one-off, an ongoing state — is when full resolution stops being worth
    // it. Tracked independently of the maxBitrate no-op-skip below, since
    // this needs to keep counting even on ticks the bitrate itself doesn't
    // change.
    const pinnedAtFloorAndCongested = congested && nextKbps <= minKbps * 1.05;
    this.sustainedFloorTicks = pinnedAtFloorAndCongested ? this.sustainedFloorTicks + 1 : 0;
    const wantScale = this.sustainedFloorTicks >= ADAPTIVE_SUSTAINED_FLOOR_TICKS ? ADAPTIVE_RESOLUTION_SCALE_DOWN : 1;
    if (wantScale !== this.currentResolutionScale) {
      this.currentResolutionScale = wantScale;
      await this.applyResolutionScale(wantScale);
      this.sendSystemCommand({ kind: "adaptive-status", resolutionScaled: wantScale > 1 });
    }

    if (Math.abs(nextKbps - current) < current * ADAPTIVE_MIN_CHANGE_FRACTION) return; // within noise, skip the churn
    this.currentAdaptiveCapKbps = nextKbps;
    await this.applyBitrateCap(nextKbps);
  }

  private async applyResolutionScale(scaleDownBy: number): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].scaleResolutionDownBy = scaleDownBy;
    await sender.setParameters(params).catch(() => undefined);
  }

  // No active recovery attempts (no ICE restart, no retries) — a brief
  // "disconnected"/"failed" blip either self-heals natively via the
  // browser's own ICE consent-freshness checks, or the connection is
  // genuinely dead and this just closes it after a short grace window
  // instead of leaving it hanging indefinitely.
  private scheduleDisconnectClose(): void {
    if (this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = null;
      if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "failed") {
        console.warn(`[ice] ${this.pc.connectionState}, closing peer connection`);
        this.close();
      }
    }, DISCONNECTED_GRACE_MS);
  }

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }

  // Temporary diagnostic for the ~40-47s mid-session drop investigation
  // (see docs/WEBRTC-TURN-DEBUGGING.md) — freeze-frames the selected
  // candidate pair and both its candidates the instant ICE first reports
  // "disconnected", to see which side stopped hearing from the other.
  private async dumpCandidatePairStats(): Promise<void> {
    const stats = await this.pc.getStats();
    const byId = new Map<string, any>();
    stats.forEach((report) => byId.set(report.id, report));
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && (report.nominated || report.state === "succeeded")) {
        const local = byId.get(report.localCandidateId);
        const remote = byId.get(report.remoteCandidateId);
        console.warn("[ice] DROP DIAGNOSTIC candidate-pair:", {
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
        });
        console.warn("[ice] DROP DIAGNOSTIC local candidate:", {
          type: local?.candidateType,
          protocol: local?.protocol,
          address: local?.address,
          port: local?.port,
          relayProtocol: local?.relayProtocol,
          url: local?.url,
        });
        console.warn("[ice] DROP DIAGNOSTIC remote candidate:", {
          type: remote?.candidateType,
          protocol: remote?.protocol,
          address: remote?.address,
          port: remote?.port,
          relayProtocol: remote?.relayProtocol,
          url: remote?.url,
        });
      }
    });
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

  // stopCaptureTracks defaults to true (matches the single-viewer case: this
  // session owns the capture stream outright). Multi-viewer hosting shares
  // one capture stream across several PeerSessions — closing any one of them
  // must not stop tracks the others are still sending, so that caller passes
  // false and takes explicit responsibility for stopping the shared stream
  // itself once the last viewer is gone (see app.ts's hostViewers teardown).
  close(stopCaptureTracks = true): void {
    this.clearDisconnectTimer();
    this.stopStatsLoop();
    this.reportCompletedSession();
    this.pendingSystemCommands = [];
    this.controlChannel?.close();
    this.filesChannel?.close();
    this.clipboardChannel?.close();
    this.chatChannel?.close();
    this.systemChannel?.close();
    if (stopCaptureTracks) this.captureStream?.getTracks().forEach((t) => t.stop());
    this.pc.close();
  }
}
