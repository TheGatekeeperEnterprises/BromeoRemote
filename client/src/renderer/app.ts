let activeCropAnimFrame: number | null = null;
// The raw, uncropped full-monitor capture behind the current dual-window
// crop — kept around so resize-dual-window (fired on every phone rotation
// while dual-window mode is active) can re-crop at the new bounds without
// requesting a brand new getDisplayMedia capture each time; only the crop
// region changes, not what's being captured.
let rawDualCaptureStream: MediaStream | null = null;

function createCroppedStream(sourceStream: MediaStream, crop: { x: number; y: number; width: number; height: number }): MediaStream {
  if (activeCropAnimFrame) cancelAnimationFrame(activeCropAnimFrame);

  const video = document.createElement("video");
  video.srcObject = sourceStream;
  video.muted = true;
  video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d")!;

  function draw() {
    if (video.videoWidth && video.videoHeight) {
      const scaleX = video.videoWidth / (window.screen.width || 1920);
      const scaleY = video.videoHeight / (window.screen.height || 1080);
      const sx = crop.x * scaleX;
      const sy = crop.y * scaleY;
      const sw = crop.width * scaleX;
      const sh = crop.height * scaleY;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    }
    activeCropAnimFrame = requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return canvas.captureStream(30);
}

let activeDualMonitorAnimFrame: number | null = null;
// The two raw, uncomposited full-monitor captures behind the current
// dual-monitor view — kept around so resize-dual-monitor (fired on every
// phone rotation) can recompose at the new aspect/split without requesting
// two brand new getDisplayMedia captures each time.
let dualMonitorStreams: { a: MediaStream; b: MediaStream } | null = null;

// Stops both raw per-monitor captures behind an active dual-monitor view —
// unlike the single-source dual-window crop, dual-monitor mode holds two
// genuinely separate desktopCapturer sessions, so switching away from it
// (to any other capture mode, or ending the session) needs to explicitly
// release both, not just drop the reference.
function stopDualMonitorRawStreams(): void {
  if (dualMonitorStreams) {
    dualMonitorStreams.a.getTracks().forEach((t) => t.stop());
    dualMonitorStreams.b.getTracks().forEach((t) => t.stop());
    dualMonitorStreams = null;
  }
  if (activeDualMonitorAnimFrame) {
    cancelAnimationFrame(activeDualMonitorAnimFrame);
    activeDualMonitorAnimFrame = null;
  }
}

// Composites two independent monitor captures into one canvas-backed
// stream, side-by-side (landscape) or stacked (portrait) — unlike
// createCroppedStream, there's no shared source to crop from: each monitor
// is its own separate MediaStream, so this draws both into halves of one
// canvas every frame.
function createDualMonitorStream(streamA: MediaStream, streamB: MediaStream, aspect: number, isPortrait: boolean): MediaStream {
  if (activeDualMonitorAnimFrame) cancelAnimationFrame(activeDualMonitorAnimFrame);

  const videoA = document.createElement("video");
  videoA.srcObject = streamA;
  videoA.muted = true;
  videoA.play().catch(() => {});
  const videoB = document.createElement("video");
  videoB.srcObject = streamB;
  videoB.muted = true;
  videoB.play().catch(() => {});

  const canvas = document.createElement("canvas");
  const BASE = 1080;
  if (isPortrait) {
    canvas.width = BASE;
    canvas.height = Math.round(BASE / aspect);
  } else {
    canvas.height = BASE;
    canvas.width = Math.round(BASE * aspect);
  }
  const ctx = canvas.getContext("2d")!;

  // "Contain"-fits one monitor's frame within its half-rect, centered —
  // two monitors are rarely the same resolution/aspect, so this letterboxes
  // within the half rather than stretching either one to fill it.
  function drawHalf(video: HTMLVideoElement, hx: number, hy: number, hw: number, hh: number): void {
    if (!video.videoWidth || !video.videoHeight) return;
    const srcAspect = video.videoWidth / video.videoHeight;
    const halfAspect = hw / hh;
    let dw = hw;
    let dh = hh;
    if (srcAspect > halfAspect) dh = hw / srcAspect;
    else dw = hh * srcAspect;
    ctx.drawImage(video, hx + (hw - dw) / 2, hy + (hh - dh) / 2, dw, dh);
  }

  function draw(): void {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (isPortrait) {
      drawHalf(videoA, 0, 0, canvas.width, canvas.height / 2);
      drawHalf(videoB, 0, canvas.height / 2, canvas.width, canvas.height / 2);
    } else {
      drawHalf(videoA, 0, 0, canvas.width / 2, canvas.height);
      drawHalf(videoB, canvas.width / 2, 0, canvas.width / 2, canvas.height);
    }
    activeDualMonitorAnimFrame = requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return canvas.captureStream(30);
}

let activeWebcamOverlayAnimFrame: number | null = null;

// Composites the host's webcam as a small picture-in-picture overlay onto
// the current screen capture — same "draw before encoding" principle as
// createDualMonitorStream, so this stays one encoded video track per
// viewer even in webinar mode with up to 12 attendees: no extra
// per-viewer encode cost from adding the camera, since the compositing
// happens once, before the (single) encoder ever sees the frame.
function createWebcamOverlayStream(screenStream: MediaStream, webcamStream: MediaStream): MediaStream {
  if (activeWebcamOverlayAnimFrame) cancelAnimationFrame(activeWebcamOverlayAnimFrame);

  const screenVideo = document.createElement("video");
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  screenVideo.play().catch(() => {});
  const camVideo = document.createElement("video");
  camVideo.srcObject = webcamStream;
  camVideo.muted = true;
  camVideo.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  let sizedFromScreen = false;

  function draw(): void {
    if (screenVideo.videoWidth && screenVideo.videoHeight) {
      if (!sizedFromScreen) {
        canvas.width = screenVideo.videoWidth;
        canvas.height = screenVideo.videoHeight;
        sizedFromScreen = true;
      }
      ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    }
    if (camVideo.videoWidth && camVideo.videoHeight) {
      // "Cover"-fits (crops rather than letterboxes) into a fixed corner
      // box — the usual PiP look, and avoids empty bars around a webcam
      // feed whose aspect rarely matches the box exactly.
      const boxW = canvas.width * 0.22;
      const boxH = boxW * (9 / 16);
      const margin = canvas.width * 0.02;
      const bx = canvas.width - boxW - margin;
      const by = canvas.height - boxH - margin;
      const camAspect = camVideo.videoWidth / camVideo.videoHeight;
      const boxAspect = boxW / boxH;
      let sw = camVideo.videoWidth;
      let sh = camVideo.videoHeight;
      let sx = 0;
      let sy = 0;
      if (camAspect > boxAspect) {
        sw = sh * boxAspect;
        sx = (camVideo.videoWidth - sw) / 2;
      } else {
        sh = sw / boxAspect;
        sy = (camVideo.videoHeight - sh) / 2;
      }
      const radius = boxW * 0.04;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, radius);
      ctx.clip();
      ctx.drawImage(camVideo, sx, sy, sw, sh, bx, by, boxW, boxH);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(2, boxW * 0.01);
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, radius);
      ctx.stroke();
    }
    activeWebcamOverlayAnimFrame = requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return canvas.captureStream(30);
}

import { DEFAULT_SIGNALING_URL, DEFAULT_ICE_SERVERS } from "../shared/config.js";
import type { ServerMessage } from "../shared/protocol.js";
import type { AnnotationShape, CursorShapeName, InputEvent, MonitorInfo, NotificationPayload, QualityLevel, ResolutionMode, SavedDevice, SessionPermissions, SystemCommand, UpdateStatus } from "../shared/protocol.js";
import type { MiniControllerState } from "./global";
import { sha256Hex } from "./crypto.js";
import { Signaling } from "./signaling.js";
import { PeerSession, type Role, type CodecPreferenceMode, type SessionCallbacks } from "./session.js";
import { BromeoI18n } from "./i18n.js";

interface NotifyHistoryEntry extends NotificationPayload {
  origin: "local" | "remote";
  replyTo?: string;
  status?: "allow" | "deny";
}

interface SessionHistoryEntry {
  id: string;
  peerId: string;
  role: Role;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  viewOnly: boolean;
  permissions?: SessionPermissions;
  filesTransferred: number;
  note: string;
  recorded?: boolean;
}

// "auto" (null) leaves WebRTC's own congestion control uncapped — high/low
// are hard ceilings for constrained connections, not floors. "high" is
// deliberately generous (not just "better than low") — screen content
// (sharp text/UI edges) needs meaningfully more bitrate per pixel than
// natural video to stay crisp at native desktop resolution, especially on
// a 4K+ capture, and this is still just a ceiling: the real bitrate used
// adapts down to whatever the connection can actually sustain regardless.
const QUALITY_BITRATE_KBPS: Record<QualityLevel, number | null> = { auto: null, high: 20000, low: 800 };
// No resolution cap — capture native. The mobile viewer's own pinch-zoom is
// capped at the point where a source pixel already maps to a device pixel
// (see getMaxZoomScale in mobile/src/App.tsx) — capturing at native
// resolution is what makes that cap actually reach real, useful detail
// instead of hitting a resolution ceiling before the zoom cap does.
// 60fps (not 30) specifically because of how much this affects *perceived*
// input latency, not just motion smoothness: each captured frame is a
// snapshot of wherever the cursor is at that instant, so halving the time
// between frames (33ms -> 16ms) halves how stale the cursor position in
// the *next available frame* can be, independent of anything else in the
// encode/network/decode pipeline. This is the one lever here that's purely
// additive — doesn't touch the codec/degradationPreference/bitrate choices
// already made deliberately for sharpness elsewhere in this file, and the
// adaptive bitrate engine (session.ts) still adapts actual bitrate to
// whatever the connection can sustain regardless of this ceiling.
// "fast" mode caps capture at 1080p so the encoder can actually sustain the
// requested frame rate on hardware that can't keep up with native/4K+ input
// (see ResolutionMode in shared/protocol.ts). Read live by every
// getDisplayMedia call below instead of being a fixed constant, so a
// resolution-preference command received mid-session (see onSystemCommand)
// takes effect on the next capture without needing anything else to change.
let captureResolutionMode: ResolutionMode = "sharp";
function getCaptureVideoConstraints(): MediaTrackConstraints {
  return captureResolutionMode === "fast"
    ? { frameRate: 60, width: { max: 1920 }, height: { max: 1080 } }
    : { frameRate: 60 };
}
// Crop rect used the last time a dual-window capture was cropped (see
// createCroppedStream) — kept so a resolution-preference change mid-session
// can re-crop a freshly re-captured raw stream without needing the viewer to
// resend the window selection.
let lastDualCropBounds: { x: number; y: number; width: number; height: number } | null = null;
const SESSION_HISTORY_KEY = "bromeo:session-history";
const IDLE_TIMEOUT_KEY = "bromeo:idle-timeout-minutes";
const RECORDING_MODE_KEY = "bromeo:recording-mode";
const TRUSTED_ONLY_KEY = "bromeo:trusted-only-connections";
const IDLE_TIMEOUT_OPTIONS = [0, 5, 15, 30, 60] as const;
type IdleTimeoutMinutes = (typeof IDLE_TIMEOUT_OPTIONS)[number];
type RecordingMode = "manual" | "auto";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  myId: $<HTMLSpanElement>("my-id"),
  myPassword: $<HTMLSpanElement>("my-password"),
  overviewLabel: $<HTMLSpanElement>("overview-label"),
  overviewId: $<HTMLSpanElement>("overview-id"),
  overviewPassword: $<HTMLSpanElement>("overview-password"),
  deviceLabel: $<HTMLInputElement>("device-label"),
  deviceLabelSave: $<HTMLButtonElement>("device-label-save"),
  copyId: $<HTMLButtonElement>("copy-id"),
  copyPassword: $<HTMLButtonElement>("copy-password"),
  copyInvite: $<HTMLButtonElement>("copy-invite"),
  regeneratePassword: $<HTMLButtonElement>("regenerate-password"),
  webinarModeToggle: $<HTMLInputElement>("webinar-mode-toggle"),
  unattendedToggle: $<HTMLInputElement>("unattended-toggle"),
  unattendedForm: $<HTMLDivElement>("unattended-form"),
  unattendedPassword: $<HTMLInputElement>("unattended-password"),
  unattendedSave: $<HTMLButtonElement>("unattended-save"),
  unattendedStrength: $<HTMLDivElement>("unattended-strength"),
  curtainToggle: $<HTMLInputElement>("curtain-toggle"),
  curtainManualToggle: $<HTMLButtonElement>("curtain-manual-toggle"),
  trustedOnlyToggle: $<HTMLInputElement>("trusted-only-toggle"),
  totpDisabledState: $<HTMLDivElement>("totp-disabled-state"),
  totpStartSetup: $<HTMLButtonElement>("totp-start-setup"),
  totpSetup: $<HTMLDivElement>("totp-setup"),
  totpSecret: $<HTMLSpanElement>("totp-secret"),
  totpQrWrap: $<HTMLDivElement>("totp-qr-wrap"),
  totpQr: $<HTMLImageElement>("totp-qr"),
  totpCopy: $<HTMLButtonElement>("totp-copy"),
  totpVerifyCode: $<HTMLInputElement>("totp-verify-code"),
  totpConfirm: $<HTMLButtonElement>("totp-confirm"),
  totpEnabledState: $<HTMLDivElement>("totp-enabled-state"),
  trustedDevicesBlock: $<HTMLDivElement>("trusted-devices-block"),
  trustedDevicesList: $<HTMLDivElement>("trusted-devices-list"),
  totpDisable: $<HTMLButtonElement>("totp-disable"),
  totpRequiredModal: $<HTMLDivElement>("totp-required-modal"),
  totpRequiredMessage: $<HTMLElement>("totp-required-message"),
  totpRequiredInput: $<HTMLInputElement>("totp-required-input"),
  totpTrustDevice: $<HTMLInputElement>("totp-trust-device"),
  totpRequiredSubmit: $<HTMLButtonElement>("totp-required-submit"),
  totpRequiredCancel: $<HTMLButtonElement>("totp-required-cancel"),
  targetId: $<HTMLInputElement>("target-id"),
  targetPassword: $<HTMLInputElement>("target-password"),
  connectBtn: $<HTMLButtonElement>("connect-btn"),
  connectStatus: $<HTMLParagraphElement>("connect-status"),
  savedDevicesFilter: $<HTMLInputElement>("saved-devices-filter"),
  savedDevicesList: $<HTMLDivElement>("saved-devices-list"),
  sessionHistorySummary: $<HTMLParagraphElement>("session-history-summary"),
  toggleSessionHistory: $<HTMLButtonElement>("toggle-session-history"),
  sessionHistoryList: $<HTMLDivElement>("session-history-list"),
  clearSessionHistory: $<HTMLButtonElement>("clear-session-history"),
  rememberDevice: $<HTMLInputElement>("remember-device"),
  rememberLabel: $<HTMLInputElement>("remember-label"),
  rememberGroup: $<HTMLInputElement>("remember-group"),
  rememberMac: $<HTMLInputElement>("remember-mac"),
  viewOnlyToggle: $<HTMLInputElement>("view-only-toggle"),
  permissionControl: $<HTMLInputElement>("permission-control"),
  permissionClipboard: $<HTMLInputElement>("permission-clipboard"),
  permissionFiles: $<HTMLInputElement>("permission-files"),
  viewOnlyBadge: $<HTMLSpanElement>("viewonly-badge"),
  themeToggle: $<HTMLButtonElement>("theme-toggle"),
  serverStatus: $<HTMLSpanElement>("server-status"),
  serverStatusText: $<HTMLSpanElement>("server-status-text"),
  home: $<HTMLElement>("home"),
  sharingBar: $<HTMLDivElement>("sharing-bar"),
  sharingText: $<HTMLSpanElement>("sharing-text"),
  sharingEnd: $<HTMLButtonElement>("sharing-end"),
  sharingPanic: $<HTMLButtonElement>("sharing-panic"),
  hostClipboardBtn: $<HTMLButtonElement>("host-clipboard-sync-btn"),
  hostVoiceToggleBtn: $<HTMLButtonElement>("host-voice-toggle-btn"),
  hostCameraToggleBtn: $<HTMLButtonElement>("host-camera-toggle-btn"),
  incomingModal: $<HTMLDivElement>("incoming-modal"),
  incomingFrom: $<HTMLElement>("incoming-from"),
  incomingAction: $<HTMLElement>("incoming-action"),
  incomingTimeout: $<HTMLElement>("incoming-timeout"),
  incomingAccept: $<HTMLButtonElement>("incoming-accept"),
  incomingDecline: $<HTMLButtonElement>("incoming-decline"),
  sessionView: $<HTMLDivElement>("session-view"),
  sessionPeer: $<HTMLSpanElement>("session-peer"),
  sessionState: $<HTMLSpanElement>("session-state"),
  sessionStats: $<HTMLSpanElement>("session-stats"),
  sessionDuration: $<HTMLSpanElement>("session-duration"),
  remoteVideo: $<HTMLVideoElement>("remote-video"),
  videoWrap: document.querySelector<HTMLDivElement>(".video-wrap")!,
  fitModeSelect: $<HTMLSelectElement>("fit-mode-select"),
  qualitySelect: $<HTMLSelectElement>("quality-select"),
  codecPreferenceSelect: $<HTMLSelectElement>("codec-preference-select"),
  resolutionPreferenceSelect: $<HTMLSelectElement>("resolution-preference-select"),
  idleTimeoutSelect: $<HTMLSelectElement>("idle-timeout-select"),
  recordingModeSelect: $<HTMLSelectElement>("recording-mode-select"),
  sessionHint: $<HTMLDivElement>("session-hint"),
  audioToggleBtn: $<HTMLButtonElement>("audio-toggle-btn"),
  clipboardBtn: $<HTMLButtonElement>("clipboard-sync-btn"),
  textToggleBtn: $<HTMLButtonElement>("text-toggle-btn"),
  textPanel: $<HTMLDivElement>("text-panel"),
  remoteTextInput: $<HTMLTextAreaElement>("remote-text-input"),
  remoteTextSendBtn: $<HTMLButtonElement>("remote-text-send-btn"),
  remoteTextClearBtn: $<HTMLButtonElement>("remote-text-clear-btn"),
  shortcutsToggleBtn: $<HTMLButtonElement>("shortcuts-toggle-btn"),
  shortcutsPanel: $<HTMLDivElement>("shortcuts-panel"),
  notesToggleBtn: $<HTMLButtonElement>("notes-toggle-btn"),
  notesPanel: $<HTMLDivElement>("notes-panel"),
  sessionNotesInput: $<HTMLTextAreaElement>("session-notes-input"),
  recordToggleBtn: $<HTMLButtonElement>("record-toggle-btn"),
  recordingIndicator: $<HTMLSpanElement>("recording-indicator"),
  recordingTime: $<HTMLSpanElement>("recording-time"),
  filesToggleBtn: $<HTMLButtonElement>("files-toggle-btn"),
  filesPanel: $<HTMLDivElement>("files-panel"),
  filesList: $<HTMLDivElement>("files-list"),
  sendFileBtn: $<HTMLButtonElement>("send-file-btn"),
  fullscreenBtn: $<HTMLButtonElement>("fullscreen-btn"),
  disconnectBtn: $<HTMLButtonElement>("session-disconnect-btn"),
  restartBtn: $<HTMLButtonElement>("restart-btn"),
  lockBtn: $<HTMLButtonElement>("lock-btn"),
  lockOnEndBtn: $<HTMLButtonElement>("lock-on-end-btn"),
  blockInputBtn: $<HTMLButtonElement>("block-input-btn"),
  ctrlAltDelBtn: $<HTMLButtonElement>("ctrl-alt-del-btn"),
  sasDisabledState: $<HTMLDivElement>("sas-disabled-state"),
  sasInstallBtn: $<HTMLButtonElement>("sas-install-btn"),
  sasEnabledState: $<HTMLDivElement>("sas-enabled-state"),
  sasUninstallBtn: $<HTMLButtonElement>("sas-uninstall-btn"),
  restartConfirmModal: $<HTMLDivElement>("restart-confirm-modal"),
  restartTarget: $<HTMLElement>("restart-target"),
  restartConfirmBtn: $<HTMLButtonElement>("restart-confirm"),
  restartCancelBtn: $<HTMLButtonElement>("restart-cancel"),
  monitorSelect: $<HTMLSelectElement>("monitor-select"),
  annotateToggleBtn: $<HTMLButtonElement>("annotate-toggle-btn"),
  voiceToggleBtn: $<HTMLButtonElement>("voice-toggle-btn"),
  voiceAudio: $<HTMLAudioElement>("voice-audio"),
  annotationCanvas: $<HTMLCanvasElement>("annotation-canvas"),
  annotateToolbar: $<HTMLDivElement>("annotate-toolbar"),
  annotateClearBtn: $<HTMLButtonElement>("annotate-clear-btn"),
  chatToggleBtn: $<HTMLButtonElement>("chat-toggle-btn"),
  chatPanel: $<HTMLDivElement>("chat-panel"),
  chatMessages: $<HTMLDivElement>("chat-messages"),
  chatInput: $<HTMLInputElement>("chat-input"),
  chatSendBtn: $<HTMLButtonElement>("chat-send-btn"),
  hostChatToggleBtn: $<HTMLButtonElement>("host-chat-toggle-btn"),
  hostChatPanel: $<HTMLDivElement>("host-chat-panel"),
  hostChatMessages: $<HTMLDivElement>("host-chat-messages"),
  hostChatInput: $<HTMLInputElement>("host-chat-input"),
  hostChatSendBtn: $<HTMLButtonElement>("host-chat-send-btn"),
  aiBuddyToggleBtn: $<HTMLButtonElement>("ai-buddy-toggle-btn"),
  aiBuddyPanel: $<HTMLDivElement>("ai-buddy-panel"),
  aiBuddyStatus: $<HTMLSpanElement>("ai-buddy-status"),
  aiBuddyMessages: $<HTMLDivElement>("ai-buddy-messages"),
  aiBuddyScreenshotPreview: $<HTMLDivElement>("ai-buddy-screenshot-preview"),
  aiBuddyScreenshotImg: $<HTMLImageElement>("ai-buddy-screenshot-img"),
  aiBuddyScreenshotRemove: $<HTMLButtonElement>("ai-buddy-screenshot-remove"),
  aiBuddyScreenshotBtn: $<HTMLButtonElement>("ai-buddy-screenshot-btn"),
  aiBuddyInput: $<HTMLInputElement>("ai-buddy-input"),
  aiBuddySendBtn: $<HTMLButtonElement>("ai-buddy-send-btn"),
  aiBuddyCaptureCanvas: $<HTMLCanvasElement>("ai-buddy-capture-canvas"),
  openaiKeyInput: $<HTMLInputElement>("openai-key-input"),
  openaiKeySave: $<HTMLButtonElement>("openai-key-save"),
  openaiKeyStatus: $<HTMLParagraphElement>("openai-key-status"),
  toast: $<HTMLDivElement>("toast"),
  notifyForwardId: $<HTMLInputElement>("notify-forward-id"),
  notifyForwardSave: $<HTMLButtonElement>("notify-forward-save"),
  notifyBellBtn: $<HTMLButtonElement>("notify-bell-btn"),
  notifyBadge: $<HTMLSpanElement>("notify-badge"),
  notifyPanel: $<HTMLDivElement>("notify-panel"),
  notifyList: $<HTMLDivElement>("notify-list"),
  notifyClearBtn: $<HTMLButtonElement>("notify-clear-btn"),
  bridgeConfirmModal: $<HTMLDivElement>("bridge-confirm-modal"),
  bridgeConfirmTitle: $<HTMLElement>("bridge-confirm-title"),
  bridgeConfirmSource: $<HTMLElement>("bridge-confirm-source"),
  bridgeConfirmMessage: $<HTMLElement>("bridge-confirm-message"),
  bridgeConfirmRisk: $<HTMLSpanElement>("bridge-confirm-risk"),
  bridgeConfirmCommand: $<HTMLPreElement>("bridge-confirm-command"),
  bridgeConfirmAllow: $<HTMLButtonElement>("bridge-confirm-allow"),
  bridgeConfirmDeny: $<HTMLButtonElement>("bridge-confirm-deny"),
  bridgeConfirmView: $<HTMLButtonElement>("bridge-confirm-view"),
  appVersion: $<HTMLSpanElement>("app-version"),
  checkUpdatesBtn: $<HTMLButtonElement>("check-updates-btn"),
  updateStatusText: $<HTMLSpanElement>("update-status-text"),
  installUpdateBtn: $<HTMLButtonElement>("install-update-btn"),
};

let myId = "";
let signaling: Signaling;
let currentSession: PeerSession | null = null;
let currentRole: Role | null = null;
let deviceLabel = "";
let incomingTimerHandle: ReturnType<typeof setInterval> | null = null;
let incomingExpiresAt = 0;
let sessionViewOnly = false;
let notifyForwardId: string | null = null;
let notifyHistory: NotifyHistoryEntry[] = [];
let confirmQueue: NotifyHistoryEntry[] = [];
let activeConfirm: NotifyHistoryEntry | null = null;
let unseenNotifyCount = 0;
let savedDevices: SavedDevice[] = [];
let sessionHistoryExpanded = false;
let lastConnectAttempt: { targetId: string; passwordHash: string; viewOnly: boolean; permissions: SessionPermissions } | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingTimerHandle: ReturnType<typeof setInterval> | null = null;
let recordingStartedAt = 0;
let sessionStartedAt: number | null = null;
let sessionDurationHandle: ReturnType<typeof setInterval> | null = null;
let filesTransferredCount = 0;
let chatLog: { text: string; timestamp: number; mine: boolean }[] = [];
// --- Annotation/whiteboard overlay (viewer role — see wireAnnotationCapture) ---
const ANNOTATION_COLOR = "#ff3b3b";
let annotateModeActive = false;
let annotationShapes: AnnotationShape[] = [];
let currentStrokeId: string | null = null;
let currentStrokePoints: { x: number; y: number }[] = [];
let aiBuddyLog: { role: "user" | "assistant"; text: string; imageBase64?: string; timestamp: number }[] = [];
let aiBuddyPendingScreenshot: string | null = null;
let aiBuddySending = false;
let restartRequestedFor: string | null = null;
let curtainModeEnabled = false;
let monitorIsOff = false;
// Host-drawn whiteboard (host role — the host's own full-screen draw overlay
// window; see setHostAnnotationOverlayActive in main.ts). Distinct from the
// viewer-role annotate state above: this side only relays strokes, it never
// renders them locally.
let hostWhiteboardActive = false;
let inputBlocked = false;
let wallpaperHidden = false;
let lockOnSessionEnd = false;
// Polls the host's actual OS cursor shape while a session is connected, and
// tells the viewer whenever it changes (see the "cursor-shape" SystemCommand)
// so its overlay can match — link hover = hand, text field = I-beam, etc.,
// like a real remote-desktop client. Only sends on change, not every poll.
let cursorShapePollTimer: ReturnType<typeof setInterval> | null = null;
let lastSentCursorShape: CursorShapeName | null = null;
const CURSOR_SHAPE_POLL_INTERVAL_MS = 120;
let trustedOnlyConnections = false;
let currentPeerId: string | null = null;
let sessionPermissions: SessionPermissions = defaultPermissions(false);

// --- Multi-viewer hosting (host role only — the viewer-role state above is
// untouched, a viewer only ever connects to one host). Phase 1: at most one
// viewer has control at a time; anyone joining while another viewer is
// already connected is forced to view-only at first, but control can be
// handed off afterward via promoteViewerToControl — sidesteps concurrent
// control entirely (never more than one controller) without permanently
// locking control to whoever happened to connect first. See
// docs/features.md's scoring and
// C:\Users\Stream PC\.claude\plans\parsed-brewing-frost.md for the original design. ---
interface HostViewerConnection {
  session: PeerSession;
  peerId: string;
  label: string;
  permissions: SessionPermissions;
  viewOnly: boolean;
  // True only for whoever triggered the hosting session's initial capture —
  // purely about connection ORDER, for one-time-per-session setup (curtain
  // mode, sending the monitor list, showing vs. updating the mini
  // controller). NOT the same as "currently has control" — that's
  // permissions.control, which can move via promoteViewerToControl while
  // isFirstViewer never changes for the life of the hosting session.
  isFirstViewer: boolean;
  connectedAt: number;
}
const hostViewers = new Map<string, HostViewerConnection>();

function getControllingViewer(): HostViewerConnection | undefined {
  return [...hostViewers.values()].find((v) => v.permissions.control);
}
let hostCaptureStream: MediaStream | null = null;
// Chromium spins up a genuinely separate hardware encoder session per
// RTCRtpSender/PeerConnection — consumer GPU drivers commonly cap concurrent
// hw H264 encode sessions as low as 2-4, beyond which extra sessions
// silently fall back to (much heavier) software encode. 3 is a safe phase-1
// ceiling.
const MAX_CONCURRENT_VIEWERS = 3;
// Webinar mode deliberately accepts that most of these 12 will fall back to
// software encoding (see MAX_CONCURRENT_VIEWERS' own comment) — real host
// CPU load, not an architectural wall, and the adaptive-bitrate engine
// already eases quality under load rather than failing outright.
const WEBINAR_MAX_VIEWERS = 12;
let webinarModeActive = false;
let pendingIncomingQueue: { fromId: string; viewOnly: boolean; permissions: SessionPermissions; isExtra: boolean; fromLabel?: string }[] = [];
let remoteAudioMuted = false;
let idleTimeoutMinutes: IdleTimeoutMinutes = 0;
let idleTimerHandle: ReturnType<typeof setInterval> | null = null;
let lastSessionActivityAt = 0;
let recordingMode: RecordingMode = "manual";
let sessionWasRecorded = false;
type RemoteFitMode = "fit" | "actual" | "stretch";

function toast(msg: string): void {
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  setTimeout(() => el.toast.classList.add("hidden"), 3200);
}

function setIconButtonState(button: HTMLButtonElement, label: string, iconId?: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
  const srLabel = button.querySelector<HTMLElement>(".sr-only");
  if (srLabel) srLabel.textContent = label;
  const visibleLabel = button.querySelector<HTMLElement>(".toolbar-visible-label");
  if (visibleLabel) visibleLabel.textContent = label;
  const use = button.querySelector<SVGUseElement>("use");
  if (use && iconId) use.setAttribute("href", `#${iconId}`);
}

async function init(): Promise<void> {
  BromeoI18n.applyTranslations();
  document.querySelectorAll<HTMLButtonElement>("[data-lang-switch]").forEach((btn) => {
    btn.onclick = () => BromeoI18n.setLang(btn.getAttribute("data-lang-switch") === "nl" ? "nl" : "en");
  });

  const cfg = await window.bromeo.getConfig();
  myId = cfg.deviceId;
  deviceLabel = cfg.deviceLabel || BromeoI18n.t("msg.defaultDeviceLabel");
  el.deviceLabel.value = deviceLabel;
  el.overviewLabel.textContent = deviceLabel;
  el.myId.textContent = formatId(cfg.deviceId);
  updateSessionPassword(cfg.sessionPassword);
  el.overviewId.textContent = formatId(cfg.deviceId);
  el.unattendedToggle.checked = cfg.unattendedEnabled;
  el.unattendedForm.classList.toggle("hidden", !cfg.unattendedEnabled);
  document.documentElement.setAttribute("data-theme", cfg.theme);
  updateThemeIcon(cfg.theme);
  applyRemoteFitMode((localStorage.getItem("bromeo:remote-fit-mode") as RemoteFitMode | null) ?? "fit");
  applyQualityLevel((localStorage.getItem("bromeo:quality-level") as QualityLevel | null) ?? "auto", false);
  applyCodecPreference((localStorage.getItem("bromeo:codec-preference") as CodecPreferenceMode | null) ?? "sharp");
  applyResolutionPreference((localStorage.getItem("bromeo:resolution-preference") as ResolutionMode | null) ?? "sharp", false);
  applyIdleTimeout(localStorage.getItem(IDLE_TIMEOUT_KEY) ?? "0", false);
  applyRecordingMode(localStorage.getItem(RECORDING_MODE_KEY), false);
  webinarModeActive = localStorage.getItem("bromeo:webinar-mode") === "1";
  el.webinarModeToggle.checked = webinarModeActive;
  notifyForwardId = cfg.notifyForwardId;
  el.notifyForwardId.value = notifyForwardId ?? "";
  trustedOnlyConnections = localStorage.getItem(TRUSTED_ONLY_KEY) === "1";
  el.trustedOnlyToggle.checked = trustedOnlyConnections;
  window.bromeo.getOpenAiKeyStatus().then((hasKey) => {
    el.openaiKeyStatus.textContent = hasKey ? BromeoI18n.t("tools.aiBuddyKeySetStatus") : BromeoI18n.t("tools.aiBuddyKeyNotSet");
  });

  savedDevices = await window.bromeo.getSavedDevices();
  renderSavedDevices();
  renderSessionHistory();
  curtainModeEnabled = cfg.curtainModeEnabled;
  el.curtainToggle.checked = curtainModeEnabled;
  setTotpUiState(cfg.totpEnabled);
  window.bromeo.sasStatus().then(setSasUiState);

  signaling = new Signaling(DEFAULT_SIGNALING_URL);
  signaling.onMessage(onServerMessage);
  // "hello" re-registers this device's ID with the server's registry — must
  // fire on every reconnect (Signaling now retries automatically after a
  // dropped connection), not just the first one, or this PC would sit there
  // showing "Verbonden met server" but be unreachable by ID after any blip
  // (e.g. the signaling server restarting).
  signaling.onStatus((status) => {
    setServerStatus(status);
    if (status === "connected") signaling.send({ type: "hello", id: myId });
  });
  try {
    await signaling.connect();
  } catch {
    setServerStatus("disconnected");
    toast(BromeoI18n.t("msg.serverConnectFailed"));
  }

  window.bromeo.onBridgeNotification(handleBridgeNotification);

  el.appVersion.textContent = await window.bromeo.getAppVersion();
  window.bromeo.onUpdateStatus(handleUpdateStatus);
  window.bromeo.checkForUpdates(); // safe to call now — listener above is already registered

  wireUi();
}

function handleUpdateStatus(status: UpdateStatus): void {
  const messages: Record<UpdateStatus["status"], string> = {
    checking: BromeoI18n.t("update.checking"),
    available: BromeoI18n.t("update.available", { version: status.version ?? "" }),
    "not-available": BromeoI18n.t("update.notAvailable"),
    downloading: BromeoI18n.t("update.downloading", { percent: status.percent ?? 0 }),
    downloaded: BromeoI18n.t("update.downloaded", { version: status.version ?? "" }),
    error: BromeoI18n.t("update.error", { error: status.error ?? BromeoI18n.t("msg.unknownError") }),
  };
  el.updateStatusText.textContent = messages[status.status];
  el.installUpdateBtn.classList.toggle("hidden", status.status !== "downloaded");
}

function updateThemeIcon(theme: "dark" | "light"): void {
  el.themeToggle.textContent = theme === "light" ? "☾" : "☀";
  el.themeToggle.title = theme === "light" ? BromeoI18n.t("theme.dark") : BromeoI18n.t("theme.light");
}

function setServerStatus(status: "connected" | "disconnected"): void {
  el.serverStatus.classList.toggle("status-pill--online", status === "connected");
  el.serverStatus.classList.toggle("status-pill--offline", status === "disconnected");
  el.serverStatus.classList.remove("status-pill--pending");
  el.serverStatusText.textContent = status === "connected" ? BromeoI18n.t("server.connected") : BromeoI18n.t("server.disconnected");
}

function formatId(id: string): string {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function formatIdInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

function defaultPermissions(viewOnly: boolean): SessionPermissions {
  return { control: !viewOnly, clipboard: true, files: true };
}

function normalizePermissions(permissions: Partial<SessionPermissions> | null | undefined, viewOnly: boolean): SessionPermissions {
  const fallback = defaultPermissions(viewOnly);
  return {
    control: viewOnly ? false : permissions?.control ?? fallback.control,
    clipboard: permissions?.clipboard ?? fallback.clipboard,
    files: permissions?.files ?? fallback.files,
  };
}

function permissionsFromUi(): SessionPermissions {
  return normalizePermissions(
    {
      control: el.permissionControl.checked,
      clipboard: el.permissionClipboard.checked,
      files: el.permissionFiles.checked,
    },
    el.viewOnlyToggle.checked
  );
}

function syncPermissionControlUi(): void {
  if (el.viewOnlyToggle.checked) {
    el.permissionControl.checked = false;
    el.permissionControl.disabled = true;
    return;
  }
  el.permissionControl.disabled = false;
  if (!el.permissionControl.checked) el.permissionControl.checked = true;
}

function permissionsSummary(permissions: SessionPermissions): string {
  const parts = [permissions.control ? BromeoI18n.t("perm.control") : BromeoI18n.t("perm.viewOnly")];
  if (permissions.clipboard) parts.push(BromeoI18n.t("perm.clipboard"));
  if (permissions.files) parts.push(BromeoI18n.t("perm.files"));
  return parts.join(", ");
}

function permissionBadges(permissions: SessionPermissions): string {
  return [
    !permissions.control ? `<span class="badge-tag">${BromeoI18n.t("session.viewOnlyBadge")}</span>` : "",
    !permissions.clipboard ? `<span class="badge-tag">${BromeoI18n.t("badge.noClipboard")}</span>` : "",
    !permissions.files ? `<span class="badge-tag">${BromeoI18n.t("badge.noFiles")}</span>` : "",
  ].join("");
}

async function copyWithFeedback(text: string, button: HTMLButtonElement, message: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const label = button.textContent ?? "";
  button.textContent = BromeoI18n.t("msg.copied");
  button.disabled = true;
  toast(message);
  setTimeout(() => {
    button.textContent = label;
    button.disabled = false;
  }, 1200);
}

function updateSessionPassword(password: string): void {
  el.myPassword.textContent = password;
  el.overviewPassword.textContent = password;
}

function buildInviteText(): string {
  const password = el.myPassword.textContent ?? "";
  return [
    BromeoI18n.t("invite.line1"),
    BromeoI18n.t("invite.deviceName", { label: deviceLabel }),
    BromeoI18n.t("invite.id", { id: formatId(myId) }),
    BromeoI18n.t("invite.password", { password }),
    "",
    BromeoI18n.t("invite.instructions"),
  ].join("\n");
}

async function regenerateSessionPassword(showToast = true): Promise<void> {
  const newPassword = await window.bromeo.regeneratePassword();
  updateSessionPassword(newPassword);
  if (showToast) toast(BromeoI18n.t("msg.newPasswordGenerated"));
}

async function saveDeviceLabel(): Promise<void> {
  const label = el.deviceLabel.value.trim();
  if (label.length < 2) {
    toast(BromeoI18n.t("msg.deviceNameTooShort"));
    return;
  }
  deviceLabel = await window.bromeo.setDeviceLabel(label);
  el.deviceLabel.value = deviceLabel;
  el.overviewLabel.textContent = deviceLabel;
  toast(BromeoI18n.t("msg.deviceNameSaved"));
}

function updatePasswordStrength(): void {
  const visible = el.unattendedToggle.checked;
  const password = el.unattendedPassword.value;
  let level: "" | "weak" | "ok" | "good" | "strong" = "";
  let label = BromeoI18n.t("strength.min6");

  if (password) {
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) {
      level = "weak";
      label = BromeoI18n.t("strength.weak");
    } else if (score <= 3) {
      level = "ok";
      label = BromeoI18n.t("strength.ok");
    } else if (score === 4) {
      level = "good";
      label = BromeoI18n.t("strength.good");
    } else {
      level = "strong";
      label = BromeoI18n.t("strength.strong");
    }
  }

  el.unattendedStrength.className = `password-strength${visible ? "" : " hidden"}${level ? ` password-strength--${level}` : ""}`;
  const labelEl = el.unattendedStrength.querySelector("strong");
  if (labelEl) labelEl.textContent = label;
}

function applyRemoteFitMode(mode: RemoteFitMode): void {
  const normalized: RemoteFitMode = ["fit", "actual", "stretch"].includes(mode) ? mode : "fit";
  el.videoWrap.dataset.fit = normalized;
  el.fitModeSelect.value = normalized;
  localStorage.setItem("bromeo:remote-fit-mode", normalized);
}

function applyQualityLevel(level: QualityLevel, notifyPeer = true): void {
  const normalized: QualityLevel = ["auto", "high", "low"].includes(level) ? level : "auto";
  el.qualitySelect.value = normalized;
  localStorage.setItem("bromeo:quality-level", normalized);
  if (notifyPeer && currentRole === "viewer" && currentSession) {
    currentSession.sendSystemCommand({ kind: "quality-request", level: normalized });
  }
}

function qualityLabel(level: QualityLevel): string {
  return { auto: BromeoI18n.t("quality.auto"), high: BromeoI18n.t("quality.high"), low: BromeoI18n.t("quality.low") }[level];
}

// Unlike quality/failsafe, this can't be applied to an already-running
// session — codec order is only settled once, at the offer that starts it
// (see PeerSession.startAsViewer/preferScreenContentCodecs). Just persists
// the pick for whenever the next connection actually starts.
function applyCodecPreference(mode: CodecPreferenceMode): void {
  el.codecPreferenceSelect.value = mode;
  localStorage.setItem("bromeo:codec-preference", mode);
}

// Unlike codec, resolution CAN change on an already-running session — it's
// just a fresh getDisplayMedia + replaceVideoTrack (see onSystemCommand's
// "resolution-preference" handler), the same mechanism switch-window already
// uses, so this notifies the peer live instead of only applying next connect.
function applyResolutionPreference(mode: ResolutionMode, notifyPeer = true): void {
  const normalized: ResolutionMode = ["sharp", "fast"].includes(mode) ? mode : "sharp";
  el.resolutionPreferenceSelect.value = normalized;
  localStorage.setItem("bromeo:resolution-preference", normalized);
  if (notifyPeer && currentRole === "viewer" && currentSession) {
    currentSession.sendSystemCommand({ kind: "resolution-preference", mode: normalized });
  }
}

function parseIdleTimeout(value: string | number | null): IdleTimeoutMinutes {
  const candidate = typeof value === "number" ? value : Number(value ?? 0);
  return IDLE_TIMEOUT_OPTIONS.includes(candidate as IdleTimeoutMinutes) ? (candidate as IdleTimeoutMinutes) : 0;
}

function applyIdleTimeout(value: string | number | null, showToast = true): void {
  idleTimeoutMinutes = parseIdleTimeout(value);
  el.idleTimeoutSelect.value = String(idleTimeoutMinutes);
  localStorage.setItem(IDLE_TIMEOUT_KEY, String(idleTimeoutMinutes));
  markSessionActivity();
  if (currentSession) startIdleTimer();
  if (!showToast) return;
  toast(
    idleTimeoutMinutes === 0
      ? BromeoI18n.t("msg.idleDisabled")
      : BromeoI18n.t("msg.idleWillDisconnect", { minutes: idleTimeoutMinutes })
  );
}

function markSessionActivity(): void {
  if (!currentSession) return;
  lastSessionActivityAt = Date.now();
}

function startIdleTimer(): void {
  stopIdleTimer();
  lastSessionActivityAt = Date.now();
  if (idleTimeoutMinutes === 0) return;

  idleTimerHandle = setInterval(() => {
    if (!currentSession || idleTimeoutMinutes === 0) {
      stopIdleTimer();
      return;
    }
    const idleForMs = Date.now() - lastSessionActivityAt;
    if (idleForMs >= idleTimeoutMinutes * 60 * 1000) {
      toast(BromeoI18n.t("msg.idleAutoDisconnected", { minutes: idleTimeoutMinutes }));
      endSession();
    }
  }, 10_000);
}

function stopIdleTimer(): void {
  if (idleTimerHandle) clearInterval(idleTimerHandle);
  idleTimerHandle = null;
}

function parseRecordingMode(value: string | null): RecordingMode {
  return value === "auto" ? "auto" : "manual";
}

function applyRecordingMode(value: string | null, showToast = true): void {
  recordingMode = parseRecordingMode(value);
  el.recordingModeSelect.value = recordingMode;
  localStorage.setItem(RECORDING_MODE_KEY, recordingMode);
  if (showToast) {
    toast(recordingMode === "auto" ? BromeoI18n.t("msg.recordingAutoOn") : BromeoI18n.t("msg.recordingManual"));
  }
  if (recordingMode === "auto" && currentRole === "viewer" && el.remoteVideo.srcObject && (!mediaRecorder || mediaRecorder.state === "inactive")) {
    startRecording(true);
  }
}

function formatSessionStats(stats: { fps: number | null; bitrateKbps: number | null; rttMs: number | null }): string {
  const parts = [];
  if (stats.fps != null) parts.push(`${stats.fps} fps`);
  if (stats.bitrateKbps != null) {
    parts.push(stats.bitrateKbps >= 1000 ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps` : `${stats.bitrateKbps} kbps`);
  }
  if (stats.rttMs != null) parts.push(`${stats.rttMs} ms`);
  return parts.length > 0 ? parts.join(" | ") : BromeoI18n.t("stats.pending");
}

function toggleRemoteAudio(): void {
  remoteAudioMuted = !remoteAudioMuted;
  el.remoteVideo.muted = remoteAudioMuted;
  setIconButtonState(el.audioToggleBtn, remoteAudioMuted ? BromeoI18n.t("msg.soundOn") : BromeoI18n.t("session.soundOff"), remoteAudioMuted ? "icon-volume" : "icon-volume-x");
  toast(remoteAudioMuted ? BromeoI18n.t("msg.soundMuted") : BromeoI18n.t("msg.soundOnToast"));
}

function sendRemoteText(): void {
  const text = el.remoteTextInput.value;
  if (!text.trim()) {
    toast(BromeoI18n.t("msg.textEmpty"));
    return;
  }
  if (!currentSession || currentRole !== "viewer") return;
  if (sessionViewOnly) {
    toast(BromeoI18n.t("msg.textDisabledViewOnly"));
    return;
  }
  currentSession.sendInput({ kind: "text", value: text });
  toast(BromeoI18n.t("msg.textInserted"));
  el.remoteTextInput.value = "";
  el.textPanel.classList.add("hidden");
  el.videoWrap.focus();
}

function sendShortcut(keys: Array<{ key: string; code: string }>): void {
  if (!currentSession || currentRole !== "viewer") return;
  if (sessionViewOnly) {
    toast(BromeoI18n.t("msg.shortcutsDisabledViewOnly"));
    return;
  }
  for (const key of keys) currentSession.sendInput({ kind: "keydown", ...key });
  for (const key of [...keys].reverse()) currentSession.sendInput({ kind: "keyup", ...key });
  el.videoWrap.focus();
}

function sendNamedShortcut(name: string): void {
  const shortcuts: Record<string, Array<{ key: string; code: string }>> = {
    "task-manager": [
      { key: "Control", code: "ControlLeft" },
      { key: "Shift", code: "ShiftLeft" },
      { key: "Escape", code: "Escape" },
    ],
    "alt-tab": [
      { key: "Alt", code: "AltLeft" },
      { key: "Tab", code: "Tab" },
    ],
    "win-r": [
      { key: "Meta", code: "MetaLeft" },
      { key: "r", code: "KeyR" },
    ],
    "ctrl-c": [
      { key: "Control", code: "ControlLeft" },
      { key: "c", code: "KeyC" },
    ],
    "ctrl-v": [
      { key: "Control", code: "ControlLeft" },
      { key: "v", code: "KeyV" },
    ],
    "ctrl-alt-del": [
      { key: "Control", code: "ControlLeft" },
      { key: "Alt", code: "AltLeft" },
      { key: "Delete", code: "Delete" },
    ],
  };
  const keys = shortcuts[name];
  if (!keys) return;
  sendShortcut(keys);
  el.shortcutsPanel.classList.add("hidden");
}

function toggleSessionPanel(panel: HTMLElement): void {
  const willOpen = panel.classList.contains("hidden");
  [el.filesPanel, el.chatPanel, el.textPanel, el.shortcutsPanel, el.notesPanel, el.aiBuddyPanel].forEach((p) => p.classList.add("hidden"));
  panel.classList.toggle("hidden", !willOpen);
  closeToolbarMenus();
}

function miniControllerState(): MiniControllerState | null {
  if (currentRole !== "host" || hostViewers.size === 0) return null;
  return {
    viewers: [...hostViewers.values()].map((v) => ({
      peerId: v.peerId,
      label: v.label,
      permissions: permissionsSummary(v.permissions),
      viewOnly: v.viewOnly,
    })),
    canClipboard: sessionPermissions.clipboard,
    canScreenPower: true,
    screenOff: monitorIsOff,
    whiteboardActive: hostWhiteboardActive,
  };
}

function updateMiniController(): void {
  const state = miniControllerState();
  if (state) window.bromeo.updateMiniController(state);
}

async function sendHostClipboard(): Promise<void> {
  if (!currentSession) return;
  if (!sessionPermissions.clipboard) {
    toast(BromeoI18n.t("msg.clipboardDisabledSession"));
    return;
  }
  const text = await window.bromeo.getClipboard();
  currentSession.sendClipboard(text);
  toast(BromeoI18n.t("msg.clipboardSentToPartner"));
}

async function toggleHostScreenPower(): Promise<void> {
  monitorIsOff = !monitorIsOff;
  await window.bromeo.setMonitorPower(!monitorIsOff);
  el.curtainManualToggle.textContent = monitorIsOff ? BromeoI18n.t("msg.screenOn") : BromeoI18n.t("sharingBar.curtainOff");
  updateMiniController();
}

// --- Voice intercom (host role) — one mic capture, broadcast to every
// connected viewer (mirrors broadcastVideoSwap's "one shared source, N
// senders" pattern: the same MediaStreamTrack object is attached as the
// sender track on each viewer's own voiceTransceiver). Any viewer sending
// their own voice back is handled per-connection in
// buildHostViewerCallbacks/playHostSideVoiceStream below — this only
// covers the host's outgoing side. ---
let hostMicStream: MediaStream | null = null;
const hostVoiceAudioElements = new Map<string, HTMLAudioElement>();

async function toggleHostMicrophone(): Promise<void> {
  if (hostMicStream) {
    stopHostMicrophone();
    toast(BromeoI18n.t("msg.micOff"));
    return;
  }
  try {
    hostMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = hostMicStream.getAudioTracks()[0];
    await Promise.all([...hostViewers.values()].map((v) => v.session.setMicrophoneTrack(track)));
    el.hostVoiceToggleBtn.classList.remove("btn-outline");
    el.hostVoiceToggleBtn.classList.add("btn-primary");
    toast(BromeoI18n.t("msg.micOnHost"));
  } catch (err) {
    toast(BromeoI18n.t("msg.micError", { error: (err as Error).message }));
  }
}

function stopHostMicrophone(): void {
  if (!hostMicStream) return;
  for (const v of hostViewers.values()) void v.session.setMicrophoneTrack(null);
  hostMicStream.getTracks().forEach((t) => t.stop());
  hostMicStream = null;
  el.hostVoiceToggleBtn.classList.remove("btn-primary");
  el.hostVoiceToggleBtn.classList.add("btn-outline");
}

// Multi-viewer hosting means multiple independent incoming voice streams
// (one per viewer who's turned their mic on) can be live at once — a
// dynamic <audio> element per peerId, not a single shared one, so they
// play simultaneously rather than one replacing another. Browser audio
// output mixes multiple playing elements natively, no manual mixing needed.
function playHostSideVoiceStream(peerId: string, stream: MediaStream): void {
  let audioEl = hostVoiceAudioElements.get(peerId);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);
    hostVoiceAudioElements.set(peerId, audioEl);
  }
  audioEl.srcObject = stream;
  audioEl.play().catch(() => {});
}

function stopHostSideVoiceStream(peerId: string): void {
  const audioEl = hostVoiceAudioElements.get(peerId);
  if (!audioEl) return;
  audioEl.srcObject = null;
  audioEl.remove();
  hostVoiceAudioElements.delete(peerId);
}

// --- Webcam picture-in-picture (webinar mode) — composites the host's
// webcam onto the shared screen capture before encoding, so it stays one
// video track per viewer regardless of audience size (see
// createWebcamOverlayStream's own comment). ---
let hostWebcamStream: MediaStream | null = null;
// The raw screen stream the compositor is actively drawing from —
// deliberately kept alive (not stopped) while the overlay is on, so
// turning it back off is an instant swap back, not a fresh re-capture.
let rawScreenStreamBehindOverlay: MediaStream | null = null;

async function toggleWebcamOverlay(): Promise<void> {
  if (hostWebcamStream) {
    await disableWebcamOverlay();
    toast(BromeoI18n.t("msg.cameraOff"));
    return;
  }
  if (!hostCaptureStream) {
    toast(BromeoI18n.t("msg.cameraShareScreenFirst"));
    return;
  }
  try {
    hostWebcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    rawScreenStreamBehindOverlay = hostCaptureStream;
    const composited = createWebcamOverlayStream(rawScreenStreamBehindOverlay, hostWebcamStream);
    await broadcastVideoSwap(composited, false);
    el.hostCameraToggleBtn.classList.remove("btn-outline");
    el.hostCameraToggleBtn.classList.add("btn-primary");
    toast(BromeoI18n.t("msg.cameraOn"));
  } catch (err) {
    hostWebcamStream = null;
    rawScreenStreamBehindOverlay = null;
    toast(BromeoI18n.t("msg.cameraError", { error: (err as Error).message }));
  }
}

// Turns the overlay off, restoring the already-live plain screen stream —
// no re-capture needed since toggleWebcamOverlay deliberately kept it
// alive instead of letting broadcastVideoSwap stop it.
async function disableWebcamOverlay(): Promise<void> {
  if (!hostWebcamStream) return;
  hostWebcamStream.getTracks().forEach((t) => t.stop());
  hostWebcamStream = null;
  if (rawScreenStreamBehindOverlay) {
    await broadcastVideoSwap(rawScreenStreamBehindOverlay);
    rawScreenStreamBehindOverlay = null;
  }
  el.hostCameraToggleBtn.classList.remove("btn-primary");
  el.hostCameraToggleBtn.classList.add("btn-outline");
}

async function endSessionAndRotatePassword(): Promise<void> {
  endSession();
  await regenerateSessionPassword(false);
  toast(BromeoI18n.t("msg.sessionEndedPasswordChanged"));
}

// Shows the docked chat window under the mini controller instead of
// restoring the main window — the host's screen is being shared/controlled
// during a session, so popping the full app window to the foreground would
// interrupt whatever the viewer is looking at.
function openHostChatPanel(): void {
  void window.bromeo.showHostChat();
  void window.bromeo.updateHostChat(chatLog);
}

function handleMiniControllerAction(action: string, peerId?: string): void {
  if (action === "clipboard") {
    sendHostClipboard();
  } else if (action === "chat") {
    openHostChatPanel();
  } else if (action === "screen-toggle") {
    toggleHostScreenPower();
  } else if (action === "end") {
    // A peerId means "disconnect just this one viewer" (a per-row action in
    // the mini controller's viewer list); no peerId means "stop sharing
    // entirely" (the always-visible end-all action).
    if (peerId) removeHostViewer(peerId, { sendBye: true, toastMessage: undefined });
    else endSession();
  } else if (action === "panic") {
    endSessionAndRotatePassword();
  } else if (action === "promote" && peerId) {
    promoteViewerToControl(peerId);
  } else if (action === "whiteboard") {
    void window.bromeo.toggleHostAnnotationOverlay();
  }
}

function closeToolbarMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".toolbar-menu").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.querySelector<HTMLElement>(".toolbar-menu-panel")?.classList.add("hidden");
  });
}

function wireToolbarMenus(): void {
  document.querySelectorAll<HTMLButtonElement>(".toolbar-menu-trigger").forEach((trigger) => {
    trigger.onclick = (event) => {
      event.stopPropagation();
      const menu = trigger.closest<HTMLElement>(".toolbar-menu");
      const panelId = trigger.dataset.menuTarget;
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!menu || !panel) return;
      const willOpen = panel.classList.contains("hidden");
      closeToolbarMenus(menu);
      menu.classList.toggle("is-open", willOpen);
      panel.classList.toggle("hidden", !willOpen);
    };
  });

  document.querySelectorAll<HTMLElement>(".toolbar-menu-panel").forEach((panel) => {
    panel.onclick = (event) => event.stopPropagation();
    panel.querySelectorAll<HTMLButtonElement>(".toolbar-menu-item").forEach((button) => {
      button.addEventListener("click", () => closeToolbarMenus());
    });
  });
}

function setBlockInputUi(enabled: boolean, pending = false): void {
  el.blockInputBtn.disabled = pending;
  el.blockInputBtn.classList.toggle("btn-danger", enabled);
  el.blockInputBtn.classList.toggle("btn-outline", !enabled);
  if (pending) {
    setIconButtonState(el.blockInputBtn, BromeoI18n.t("msg.blockInputPending"));
  } else {
    setIconButtonState(el.blockInputBtn, enabled ? BromeoI18n.t("msg.blockInputOn") : BromeoI18n.t("msg.blockInputOff"));
  }
}

function applyBlockInputStatus(enabled: boolean, ok: boolean): void {
  setBlockInputUi(ok && enabled);
  toast(
    ok
      ? enabled
        ? BromeoI18n.t("msg.blockInputAppliedOn")
        : BromeoI18n.t("msg.blockInputAppliedOff")
      : BromeoI18n.t("msg.blockInputApplyFailed")
  );
}

function setLockOnEndUi(enabled: boolean, pending = false): void {
  el.lockOnEndBtn.disabled = pending;
  el.lockOnEndBtn.classList.toggle("btn-danger", enabled);
  el.lockOnEndBtn.classList.toggle("btn-outline", !enabled);
  setIconButtonState(el.lockOnEndBtn, pending ? BromeoI18n.t("msg.lockOnEndPending") : enabled ? BromeoI18n.t("msg.lockOnEndOn") : BromeoI18n.t("msg.lockOnEndOff"));
}

function applyLockOnEndStatus(enabled: boolean, ok: boolean): void {
  setLockOnEndUi(ok && enabled);
  toast(
    ok
      ? enabled
        ? BromeoI18n.t("msg.lockOnEndAppliedOn")
        : BromeoI18n.t("msg.lockOnEndAppliedOff")
      : BromeoI18n.t("msg.lockOnEndApplyFailed")
  );
}

function updateSessionState(state: RTCPeerConnectionState | "starting"): void {
  const labels: Record<typeof state, string> = {
    starting: BromeoI18n.t("sessionState.connecting"),
    new: BromeoI18n.t("sessionState.connecting"),
    connecting: BromeoI18n.t("sessionState.connecting"),
    connected: BromeoI18n.t("sessionState.connected"),
    disconnected: BromeoI18n.t("sessionState.interrupted"),
    failed: BromeoI18n.t("sessionState.failed"),
    closed: BromeoI18n.t("sessionState.closed"),
  };
  el.sessionState.textContent = labels[state];
  el.sessionState.classList.toggle("session-chip--ok", state === "connected");
  el.sessionState.classList.toggle("session-chip--danger", state === "closed");
  el.sessionState.classList.toggle("session-chip--pending", state !== "connected" && state !== "closed");
}

function setTotpUiState(enabled: boolean): void {
  el.totpDisabledState.classList.toggle("hidden", enabled);
  el.totpSetup.classList.add("hidden");
  el.totpEnabledState.classList.toggle("hidden", !enabled);
  if (enabled) renderTrustedDevices();
  else el.trustedDevicesBlock.classList.add("hidden");
}

async function renderTrustedDevices(): Promise<void> {
  const devices = await window.bromeo.getTrustedDevices();
  el.trustedDevicesBlock.classList.toggle("hidden", devices.length === 0);
  if (devices.length === 0) return;
  el.trustedDevicesList.innerHTML = devices
    .map((d) => {
      const daysLeft = Math.max(0, Math.ceil((d.trustedUntil - Date.now()) / (24 * 60 * 60 * 1000)));
      return `<div class="saved-device-row">
        <div class="saved-device-info">
          <div class="saved-device-label"><span>${escapeHtml(d.label)}</span></div>
          <div class="saved-device-id">Nog ${daysLeft} dag${daysLeft === 1 ? "" : "en"} vertrouwd</div>
        </div>
        <button class="saved-device-remove" data-id="${d.id}" title="Vertrouwen intrekken">✕</button>
      </div>`;
    })
    .join("");
  el.trustedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-device-remove").forEach((btn) => {
    btn.onclick = async () => {
      await window.bromeo.removeTrustedDevice(btn.dataset.id!);
      renderTrustedDevices();
    };
  });
}

function setSasUiState(installed: boolean, pending = false): void {
  el.sasInstallBtn.disabled = pending;
  el.sasInstallBtn.textContent = pending ? BromeoI18n.t("msg.sasBusy") : BromeoI18n.t("msg.sasEnable");
  el.sasDisabledState.classList.toggle("hidden", installed);
  el.sasEnabledState.classList.toggle("hidden", !installed);
}

function startIncomingTimeout(): void {
  clearIncomingTimeout();
  incomingExpiresAt = Date.now() + 60_000;
  updateIncomingTimeout();
  incomingTimerHandle = setInterval(updateIncomingTimeout, 1000);
}

function clearIncomingTimeout(): void {
  if (incomingTimerHandle) clearInterval(incomingTimerHandle);
  incomingTimerHandle = null;
  incomingExpiresAt = 0;
}

function updateIncomingTimeout(): void {
  const next = pendingIncomingQueue[0];
  if (!next || incomingExpiresAt === 0) return;
  const remaining = Math.max(0, Math.ceil((incomingExpiresAt - Date.now()) / 1000));
  el.incomingTimeout.textContent = BromeoI18n.t("msg.incomingExpiresIn", { seconds: remaining });
  if (remaining > 0) return;
  pendingIncomingQueue.shift();
  clearIncomingTimeout();
  signaling.send({ type: "connect-response", targetId: next.fromId, accept: false, reason: "declined" });
  toast(BromeoI18n.t("msg.incomingExpired"));
  showNextIncomingRequest();
}

function wireUi(): void {
  // ── Tab navigation (topbar knoppen) ─────────────────────────────────────────
  const tabBtns = document.querySelectorAll<HTMLButtonElement>(".topbar-tab");
  const tabPanels = document.querySelectorAll<HTMLDivElement>(".tab-panel");
  function activateTab(targetTab: string): void {
    tabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === targetTab;
      btn.classList.toggle("topbar-tab--active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    tabPanels.forEach((panel) => {
      const isActive = panel.id === `tab-${targetTab}`;
      panel.classList.toggle("tab-panel--hidden", !isActive);
    });
  }
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab ?? "home"));
  });
  // Activate first tab by default
  activateTab("home");

  wireToolbarMenus();
  el.deviceLabelSave.onclick = () => saveDeviceLabel();
  el.deviceLabel.onkeydown = (e) => {
    if (e.key === "Enter") saveDeviceLabel();
  };
  el.copyId.onclick = () => copyWithFeedback(myId, el.copyId, BromeoI18n.t("msg.idCopied"));
  el.copyPassword.onclick = () => copyWithFeedback(el.myPassword.textContent ?? "", el.copyPassword, BromeoI18n.t("msg.passwordCopied"));
  el.copyInvite.onclick = () => copyWithFeedback(buildInviteText(), el.copyInvite, BromeoI18n.t("msg.inviteCopied"));
  el.regeneratePassword.onclick = () => regenerateSessionPassword();
  el.webinarModeToggle.onchange = () => {
    webinarModeActive = el.webinarModeToggle.checked;
    localStorage.setItem("bromeo:webinar-mode", webinarModeActive ? "1" : "0");
    toast(webinarModeActive ? BromeoI18n.t("msg.webinarOn") : BromeoI18n.t("msg.webinarOff"));
  };

  el.themeToggle.onclick = async () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    updateThemeIcon(next);
    await window.bromeo.setTheme(next);
  };

  el.unattendedToggle.onchange = () => {
    el.unattendedForm.classList.toggle("hidden", !el.unattendedToggle.checked);
    updatePasswordStrength();
  };
  el.unattendedPassword.oninput = () => updatePasswordStrength();
  el.unattendedSave.onclick = async () => {
    const enabled = el.unattendedToggle.checked;
    const pw = el.unattendedPassword.value.trim();
    if (enabled && pw.length < 6) {
      toast(BromeoI18n.t("msg.unattendedPasswordTooShort"));
      return;
    }
    const result = await window.bromeo.setUnattended(enabled, pw || null);
    el.unattendedToggle.checked = result.unattendedEnabled;
    el.unattendedPassword.value = "";
    toast(BromeoI18n.t("msg.unattendedSaved"));
  };

  el.connectBtn.onclick = onConnectClick;
  el.savedDevicesFilter.oninput = () => renderSavedDevices();
  el.clearSessionHistory.onclick = () => {
    setSessionHistory([]);
    sessionHistoryExpanded = false;
    renderSessionHistory();
    toast(BromeoI18n.t("msg.sessionHistoryCleared"));
  };
  el.toggleSessionHistory.onclick = () => {
    sessionHistoryExpanded = !sessionHistoryExpanded;
    renderSessionHistory();
  };
  el.targetId.oninput = () => {
    el.targetId.value = formatIdInput(el.targetId.value);
  };
  [el.targetId, el.targetPassword].forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === "Enter") onConnectClick();
    };
  });

  el.sharingEnd.onclick = () => endSession();
  el.sharingPanic.onclick = async () => {
    endSession();
    await regenerateSessionPassword(false);
    toast(BromeoI18n.t("msg.sessionEndedPasswordChanged"));
  };
  el.hostClipboardBtn.onclick = async () => {
    if (!currentSession) return;
    if (!sessionPermissions.clipboard) {
      toast(BromeoI18n.t("msg.clipboardDisabledSession"));
      return;
    }
    const text = await window.bromeo.getClipboard();
    currentSession.sendClipboard(text);
    toast(BromeoI18n.t("msg.clipboardSentToPartner"));
  };
  el.sharingPanic.onclick = () => endSessionAndRotatePassword();
  el.hostClipboardBtn.onclick = () => sendHostClipboard();
  el.hostVoiceToggleBtn.onclick = () => void toggleHostMicrophone();
  el.hostCameraToggleBtn.onclick = () => void toggleWebcamOverlay();
  window.bromeo.onMiniControllerAction(handleMiniControllerAction);
  window.bromeo.onHostAnnotationOverlayState((active) => {
    hostWhiteboardActive = active;
    updateMiniController();
  });
  window.bromeo.onHostAnnotationShape((shape) => {
    broadcastSystemCommand({ kind: "annotation-shape", shape });
  });
  window.bromeo.onHostAnnotationErase((id) => {
    broadcastSystemCommand({ kind: "annotation-erase", id });
  });
  window.bromeo.onHostAnnotationClear(() => {
    broadcastSystemCommand({ kind: "annotation-clear" });
  });
  window.bromeo.onHostChatSend((text) => sendChatText(text));

  el.incomingAccept.onclick = () => respondToIncoming(true);
  el.incomingDecline.onclick = () => respondToIncoming(false);

  el.disconnectBtn.onclick = () => endSession();
  el.fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) el.sessionView.requestFullscreen();
    else document.exitFullscreen();
  };
  document.addEventListener("fullscreenchange", () => {
    setIconButtonState(el.fullscreenBtn, document.fullscreenElement ? BromeoI18n.t("msg.windowMode") : BromeoI18n.t("msg.fullscreenMode"), document.fullscreenElement ? "icon-window" : "icon-fullscreen");
  });
  el.fitModeSelect.onchange = () => {
    applyRemoteFitMode(el.fitModeSelect.value as RemoteFitMode);
  };
  el.filesToggleBtn.onclick = () => toggleSessionPanel(el.filesPanel);
  el.audioToggleBtn.onclick = () => toggleRemoteAudio();
  el.clipboardBtn.onclick = async () => {
    if (!sessionPermissions.clipboard) {
      toast(BromeoI18n.t("msg.clipboardDisabledSession"));
      return;
    }
    const text = await window.bromeo.getClipboard();
    currentSession?.sendClipboard(text);
    toast(BromeoI18n.t("msg.clipboardSentToPartner"));
  };
  el.textToggleBtn.onclick = () => {
    if (sessionViewOnly) {
      toast(BromeoI18n.t("msg.textDisabledViewOnly"));
      return;
    }
    toggleSessionPanel(el.textPanel);
    if (!el.textPanel.classList.contains("hidden")) el.remoteTextInput.focus();
  };
  el.remoteTextSendBtn.onclick = () => sendRemoteText();
  el.remoteTextClearBtn.onclick = () => {
    el.remoteTextInput.value = "";
    el.remoteTextInput.focus();
  };
  el.shortcutsToggleBtn.onclick = () => {
    if (sessionViewOnly) {
      toast(BromeoI18n.t("msg.shortcutsDisabledViewOnly"));
      return;
    }
    toggleSessionPanel(el.shortcutsPanel);
  };
  el.notesToggleBtn.onclick = () => toggleSessionPanel(el.notesPanel);
  el.shortcutsPanel.querySelectorAll<HTMLButtonElement>(".shortcut-btn").forEach((btn) => {
    btn.onclick = () => sendNamedShortcut(btn.dataset.shortcut ?? "");
  });
  el.sendFileBtn.onclick = async () => {
    if (!sessionPermissions.files) {
      toast(BromeoI18n.t("msg.fileTransferDisabledSession"));
      return;
    }
    const file = await window.bromeo.pickFile();
    if (!file) return;
    const base64 = await window.bromeo.readFileBase64(file.path);
    await currentSession?.sendFile(file.name, base64);
    filesTransferredCount++;
    toast(BromeoI18n.t("msg.fileSent", { name: file.name }));
  };
  el.recordToggleBtn.onclick = () => toggleRecording();

  el.chatToggleBtn.onclick = () => toggleSessionPanel(el.chatPanel);
  el.chatSendBtn.onclick = () => sendChatMessage(el.chatInput);
  el.chatInput.onkeydown = (e) => {
    if (e.key === "Enter") sendChatMessage(el.chatInput);
  };
  el.hostChatToggleBtn.onclick = () => el.hostChatPanel.classList.toggle("hidden");
  el.hostChatSendBtn.onclick = () => sendChatMessage(el.hostChatInput);
  el.hostChatInput.onkeydown = (e) => {
    if (e.key === "Enter") sendChatMessage(el.hostChatInput);
  };

  el.aiBuddyToggleBtn.onclick = () => toggleSessionPanel(el.aiBuddyPanel);
  el.aiBuddyScreenshotBtn.onclick = () => {
    const frame = captureRemoteVideoFrame();
    if (!frame) {
      toast(BromeoI18n.t("msg.screenshotFailed"));
      return;
    }
    setAiBuddyScreenshot(frame);
  };
  el.aiBuddyScreenshotRemove.onclick = () => clearAiBuddyScreenshot();
  el.aiBuddySendBtn.onclick = () => sendAiBuddyMessage();
  el.aiBuddyInput.onkeydown = (e) => {
    if (e.key === "Enter") sendAiBuddyMessage();
  };

  el.restartBtn.onclick = () => {
    if (!currentSession || currentRole !== "viewer") return;
    el.restartTarget.textContent = el.sessionPeer.textContent;
    el.restartConfirmModal.classList.remove("hidden");
  };
  el.restartCancelBtn.onclick = () => el.restartConfirmModal.classList.add("hidden");
  el.restartConfirmBtn.onclick = () => {
    el.restartConfirmModal.classList.add("hidden");
    if (!currentSession || !lastConnectAttempt) return;
    currentSession.sendSystemCommand({ kind: "restart-request" });
    restartRequestedFor = lastConnectAttempt.targetId;
    toast(BromeoI18n.t("msg.restartRequested"));
  };

  // No confirmation modal here (unlike restart) — locking doesn't disconnect
  // the session or lose work, and is trivially reversible with the host's
  // own credentials.
  el.lockBtn.onclick = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "lock-request" });
    toast(BromeoI18n.t("msg.lockRequested"));
  };
  el.lockOnEndBtn.onclick = () => {
    if (!currentSession) return;
    const enabling = !el.lockOnEndBtn.classList.contains("btn-danger");
    currentSession.sendSystemCommand({ kind: "lock-on-session-end", enabled: enabling });
    setLockOnEndUi(enabling, true);
  };

  // Toggle button: shows a "pending" state immediately, then reconciles to
  // the host's actual result once "block-input-status" comes back (the host
  // may fail to apply it, e.g. insufficient privileges) — see
  // onSystemCommand's "block-input-status" case in startViewerSession.
  el.blockInputBtn.onclick = () => {
    if (!currentSession) return;
    const enabling = !el.blockInputBtn.classList.contains("btn-danger");
    currentSession.sendSystemCommand({ kind: "block-input", enabled: enabling });
    setBlockInputUi(enabling, true);
  };

  el.ctrlAltDelBtn.onclick = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "ctrl-alt-del-request" });
  };

  el.sasInstallBtn.onclick = async () => {
    setSasUiState(false, true);
    const installed = await window.bromeo.sasInstall();
    setSasUiState(installed);
    toast(installed ? BromeoI18n.t("msg.sasInstalled") : BromeoI18n.t("msg.sasInstallFailed"));
  };

  el.sasUninstallBtn.onclick = async () => {
    const success = await window.bromeo.sasUninstall(); // true = now uninstalled
    setSasUiState(!success);
    toast(success ? BromeoI18n.t("msg.sasUninstalled") : BromeoI18n.t("msg.sasUninstallFailed"));
  };

  el.monitorSelect.onchange = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "switch-monitor", monitorId: el.monitorSelect.value });
  };

  el.qualitySelect.onchange = () => {
    applyQualityLevel(el.qualitySelect.value as QualityLevel);
    toast(BromeoI18n.t("msg.qualitySet", { quality: qualityLabel(el.qualitySelect.value as QualityLevel) }));
  };
  el.codecPreferenceSelect.onchange = () => {
    const mode = el.codecPreferenceSelect.value as CodecPreferenceMode;
    applyCodecPreference(mode);
    toast(BromeoI18n.t("msg.codecSet", { mode: mode === "sharp" ? BromeoI18n.t("session.codecSharp").toLowerCase() : BromeoI18n.t("session.codecFast").toLowerCase() }));
  };
  el.resolutionPreferenceSelect.onchange = () => {
    const mode = el.resolutionPreferenceSelect.value as ResolutionMode;
    applyResolutionPreference(mode);
    toast(BromeoI18n.t("msg.resolutionSet", { mode: mode === "sharp" ? BromeoI18n.t("msg.resolutionSharpLabel") : BromeoI18n.t("msg.resolutionFastLabel") }));
  };
  el.idleTimeoutSelect.onchange = () => applyIdleTimeout(el.idleTimeoutSelect.value);
  el.recordingModeSelect.onchange = () => applyRecordingMode(el.recordingModeSelect.value);
  ["mousemove", "mousedown", "wheel", "keydown", "click"].forEach((eventName) => {
    el.sessionView.addEventListener(eventName, markSessionActivity);
  });

  el.curtainToggle.onchange = async () => {
    curtainModeEnabled = await window.bromeo.setCurtainMode(el.curtainToggle.checked);
  };
  el.trustedOnlyToggle.onchange = () => {
    trustedOnlyConnections = el.trustedOnlyToggle.checked;
    localStorage.setItem(TRUSTED_ONLY_KEY, trustedOnlyConnections ? "1" : "0");
    toast(trustedOnlyConnections ? BromeoI18n.t("msg.trustedOnlyOn") : BromeoI18n.t("msg.trustedOnlyOff"));
  };
  el.curtainManualToggle.onclick = () => toggleHostScreenPower();

  el.totpStartSetup.onclick = async () => {
    const { secret, qrDataUrl } = await window.bromeo.generateTotpSecret();
    el.totpSecret.textContent = secret;
    if (qrDataUrl) {
      el.totpQr.src = qrDataUrl;
      el.totpQrWrap.classList.remove("hidden");
    } else {
      // Non-fatal generation failure (see main.ts) — manual secret entry
      // still works, just skip showing an empty/broken image.
      el.totpQrWrap.classList.add("hidden");
    }
    el.totpVerifyCode.value = "";
    el.totpDisabledState.classList.add("hidden");
    el.totpSetup.classList.remove("hidden");
  };
  el.totpCopy.onclick = () => {
    navigator.clipboard.writeText(el.totpSecret.textContent ?? "");
    toast(BromeoI18n.t("msg.totpKeyCopied"));
  };
  el.totpConfirm.onclick = async () => {
    const { ok } = await window.bromeo.enableTotp(el.totpVerifyCode.value.trim());
    if (!ok) {
      toast(BromeoI18n.t("msg.totpSetupBadCode"));
      return;
    }
    setTotpUiState(true);
    toast(BromeoI18n.t("msg.totpEnabledUnattended"));
  };
  el.totpDisable.onclick = async () => {
    await window.bromeo.disableTotp();
    setTotpUiState(false);
    toast(BromeoI18n.t("msg.totpDisabledToast"));
  };
  el.totpRequiredCancel.onclick = () => {
    el.totpRequiredModal.classList.add("hidden");
    el.connectStatus.textContent = "";
  };
  el.totpRequiredSubmit.onclick = () => {
    if (!lastConnectAttempt) return;
    const code = el.totpRequiredInput.value.trim();
    const trustDevice = el.totpTrustDevice.checked;
    el.totpRequiredModal.classList.add("hidden");
    connectByIdAndHash(
      lastConnectAttempt.targetId,
      lastConnectAttempt.passwordHash,
      lastConnectAttempt.viewOnly,
      lastConnectAttempt.permissions,
      code,
      trustDevice
    );
  };

  el.checkUpdatesBtn.onclick = () => window.bromeo.checkForUpdates();
  el.installUpdateBtn.onclick = () => window.bromeo.installUpdate();

  el.notifyForwardSave.onclick = async () => {
    const val = el.notifyForwardId.value.replace(/\s+/g, "");
    if (val && !/^\d{9}$/.test(val)) {
      toast(BromeoI18n.t("msg.notifyIdInvalid"));
      return;
    }
    notifyForwardId = await window.bromeo.setNotifyForward(val || null);
    toast(notifyForwardId ? BromeoI18n.t("msg.notifyForwardSet", { id: formatId(notifyForwardId) }) : BromeoI18n.t("msg.notifyForwardOff"));
  };
  el.openaiKeySave.onclick = async () => {
    const key = el.openaiKeyInput.value.trim();
    const hasKey = await window.bromeo.setOpenAiKey(key || null);
    el.openaiKeyInput.value = "";
    el.openaiKeyStatus.textContent = hasKey ? BromeoI18n.t("tools.aiBuddyKeySetStatus") : BromeoI18n.t("tools.aiBuddyKeyNotSet");
    toast(hasKey ? BromeoI18n.t("msg.openaiKeySaved") : BromeoI18n.t("msg.openaiKeyRemoved"));
  };
  el.notifyBellBtn.onclick = () => {
    el.notifyPanel.classList.toggle("hidden");
    if (!el.notifyPanel.classList.contains("hidden")) {
      unseenNotifyCount = 0;
      updateNotifyBadge();
    }
  };
  el.notifyClearBtn.onclick = () => {
    notifyHistory = [];
    renderNotifyList();
  };
  el.bridgeConfirmAllow.onclick = () => answerActiveConfirm("allow");
  el.bridgeConfirmDeny.onclick = () => answerActiveConfirm("deny");
  el.bridgeConfirmView.onclick = () => viewActiveConfirmOrigin();

  el.rememberDevice.onchange = () => {
    el.rememberLabel.classList.toggle("hidden", !el.rememberDevice.checked);
    el.rememberGroup.classList.toggle("hidden", !el.rememberDevice.checked);
    el.rememberMac.classList.toggle("hidden", !el.rememberDevice.checked);
  };
  el.viewOnlyToggle.onchange = () => syncPermissionControlUi();
  el.permissionControl.onchange = () => {
    if (!el.permissionControl.checked) el.viewOnlyToggle.checked = true;
    syncPermissionControlUi();
  };
  syncPermissionControlUi();

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!(target instanceof Element) || !target.closest(".toolbar-menu")) {
      closeToolbarMenus();
    }
    if (!el.notifyPanel.classList.contains("hidden") && !el.notifyPanel.contains(target) && !el.notifyBellBtn.contains(target)) {
      el.notifyPanel.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeToolbarMenus();
  });

  wireRemoteControlCapture();
  wireAnnotationCapture();
  wireVoiceIntercom();
}

async function onConnectClick(): Promise<void> {
  const targetId = el.targetId.value.replace(/\s+/g, "");
  const password = el.targetPassword.value;
  if (!/^\d{9}$/.test(targetId)) {
    toast(BromeoI18n.t("msg.targetIdInvalid"));
    return;
  }
  const passwordHash = await sha256Hex(password);
  const permissions = permissionsFromUi();
  connectByIdAndHash(targetId, passwordHash, !permissions.control, permissions);
}

function connectByIdAndHash(
  targetId: string,
  passwordHash: string,
  viewOnly: boolean,
  permissions = defaultPermissions(viewOnly),
  totpCode?: string,
  trustDevice?: boolean
): void {
  if (currentSession) {
    toast(BromeoI18n.t("msg.activeSessionExists"));
    return;
  }
  const normalizedPermissions = normalizePermissions(permissions, viewOnly);
  lastConnectAttempt = { targetId, passwordHash, viewOnly: !normalizedPermissions.control, permissions: normalizedPermissions };
  el.connectStatus.textContent = BromeoI18n.t("msg.connectingStatus");
  signaling.send({
    type: "connect-request",
    targetId,
    fromId: myId,
    fromLabel: deviceLabel,
    passwordHash,
    viewOnly: !normalizedPermissions.control,
    permissions: normalizedPermissions,
    totpCode,
    trustDevice,
  });
}

function connectToSavedDevice(device: SavedDevice): void {
  connectByIdAndHash(device.id, device.passwordHash, device.viewOnly, normalizePermissions(device.permissions, device.viewOnly));
}

function scheduleAutoReconnect(targetId: string, passwordHash: string, viewOnly: boolean, permissions: SessionPermissions): void {
  const intervalMs = 15_000;
  const maxAttempts = 20; // ~5 minutes
  let attempt = 0;
  toast(BromeoI18n.t("msg.autoReconnecting", { id: formatId(targetId) }));
  const tryOnce = () => {
    attempt++;
    if (currentSession || attempt > maxAttempts) return;
    connectByIdAndHash(targetId, passwordHash, viewOnly, permissions);
    setTimeout(tryOnce, intervalMs);
  };
  setTimeout(tryOnce, intervalMs);
}

function viewActiveConfirmOrigin(): void {
  if (!activeConfirm || activeConfirm.origin !== "remote" || !activeConfirm.replyTo) return;
  const targetId = activeConfirm.replyTo;
  // Only hides the dialog — the confirmation itself stays pending (and will
  // still safely time out to "deny") until it's actually answered.
  el.bridgeConfirmModal.classList.add("hidden");
  const saved = savedDevices.find((d) => d.id === targetId);
  if (saved) {
    connectToSavedDevice(saved);
  } else {
    el.targetId.value = formatId(targetId);
    el.targetPassword.focus();
    toast(BromeoI18n.t("msg.enterPartnerPassword"));
  }
}

// --- Saved / trusted devices (one-tap reconnect) ---

function renderSavedDevices(): void {
  if (savedDevices.length === 0) {
    el.savedDevicesFilter.classList.add("hidden");
    el.savedDevicesList.classList.add("hidden");
    el.savedDevicesList.innerHTML = "";
    return;
  }
  el.savedDevicesFilter.classList.remove("hidden");
  el.savedDevicesList.classList.remove("hidden");

  const filter = el.savedDevicesFilter.value.trim().toLocaleLowerCase(BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB");
  const visibleDevices = filter
    ? savedDevices.filter((d) => {
        const haystack = [d.label, d.id, formatId(d.id), d.group ?? "", d.mac ?? ""].join(" ").toLocaleLowerCase(BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB");
        return haystack.includes(filter);
      })
    : savedDevices;

  if (visibleDevices.length === 0) {
    el.savedDevicesList.innerHTML = `<p class="muted small">${BromeoI18n.t("msg.noSavedDevicesFound")}</p>`;
    return;
  }

  const otherGroupLabel = BromeoI18n.t("msg.otherGroup");
  const favorites = visibleDevices.filter((d) => d.favorite);
  const rest = visibleDevices.filter((d) => !d.favorite);
  const groups = new Map<string, SavedDevice[]>();
  for (const d of rest) {
    const key = d.group?.trim() || otherGroupLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  const sortedGroupNames = [...groups.keys()].sort((a, b) => (a === otherGroupLabel ? 1 : b === otherGroupLabel ? -1 : a.localeCompare(b)));

  let html = "";
  if (favorites.length > 0) html += renderDeviceRows(favorites, BromeoI18n.t("msg.favorites"));
  for (const name of sortedGroupNames) html += renderDeviceRows(groups.get(name)!, name);
  el.savedDevicesList.innerHTML = html;

  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-connect-btn").forEach((btn) => {
    btn.onclick = () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (device) connectToSavedDevice(device);
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-device-remove").forEach((btn) => {
    btn.onclick = async () => {
      savedDevices = await window.bromeo.removeSavedDevice(btn.dataset.id!);
      renderSavedDevices();
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-wake-btn").forEach((btn) => {
    btn.onclick = async () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (!device?.mac) return;
      const res = await window.bromeo.wakeDevice(device.mac);
      toast(res.ok ? BromeoI18n.t("msg.wakeSent", { label: device.label }) : BromeoI18n.t("msg.wakeFailed", { error: res.error ?? "" }));
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-favorite-btn").forEach((btn) => {
    btn.onclick = async () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (!device) return;
      savedDevices = await window.bromeo.saveDevice({ ...device, favorite: !device.favorite });
      renderSavedDevices();
    };
  });
}

function renderDeviceRows(devices: SavedDevice[], groupLabel: string): string {
  const rows = devices
    .map(
      (d) => `<div class="saved-device-row">
        <button class="saved-favorite-btn ${d.favorite ? "is-active" : ""}" data-id="${d.id}" title="${d.favorite ? BromeoI18n.t("msg.favoriteRemove") : BromeoI18n.t("msg.favoriteAdd")}">${d.favorite ? "★" : "☆"}</button>
        <div class="saved-device-info">
          <div class="saved-device-label"><span>${escapeHtml(d.label)}</span> ${permissionBadges(normalizePermissions(d.permissions, d.viewOnly))}</div>
          <div class="saved-device-id">${formatId(d.id)}</div>
        </div>
        ${d.mac ? `<button class="btn btn-outline btn-sm saved-wake-btn" data-id="${d.id}" title="Wake-on-LAN">${BromeoI18n.t("msg.wakeButton")}</button>` : ""}
        <button class="btn btn-primary btn-sm saved-connect-btn" data-id="${d.id}">${BromeoI18n.t("connectCard.connect")}</button>
        <button class="saved-device-remove" data-id="${d.id}" title="${BromeoI18n.t("msg.remove")}">✕</button>
      </div>`
    )
    .join("");
  return `<div class="saved-devices-group"><div class="saved-devices-group-label">${escapeHtml(groupLabel)}</div>${rows}</div>`;
}

function getSessionHistory(): SessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SESSION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setSessionHistory(history: SessionHistoryEntry[]): void {
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history.slice(0, 25)));
}

function renderSessionHistory(): void {
  const history = getSessionHistory();
  const locale = BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB";
  if (history.length === 0) {
    el.sessionHistorySummary.textContent = BromeoI18n.t("msg.noSessionsSavedYet");
    el.sessionHistoryList.innerHTML = `<p class="muted small">${BromeoI18n.t("sessions.emptyList")}</p>`;
    el.sessionHistoryList.classList.add("hidden");
    el.toggleSessionHistory.textContent = BromeoI18n.t("sessions.show");
    el.toggleSessionHistory.disabled = true;
    el.clearSessionHistory.disabled = true;
    return;
  }
  const latest = history[0];
  const latestStarted = new Date(latest.startedAt).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const latestDirection = latest.role === "viewer" ? BromeoI18n.t("msg.lastOutgoing") : BromeoI18n.t("msg.lastIncoming");
  el.sessionHistorySummary.textContent = BromeoI18n.t("msg.sessionHistorySummary", {
    count: history.length,
    direction: latestDirection,
    started: latestStarted,
    peerId: formatId(latest.peerId),
  });
  el.toggleSessionHistory.disabled = false;
  el.clearSessionHistory.disabled = false;
  el.toggleSessionHistory.textContent = sessionHistoryExpanded ? BromeoI18n.t("sessions.hide") : BromeoI18n.t("sessions.show");
  el.sessionHistoryList.classList.toggle("hidden", !sessionHistoryExpanded);
  if (!sessionHistoryExpanded) {
    el.sessionHistoryList.innerHTML = "";
    return;
  }

  const visibleHistory = history.slice(0, 5);
  const rows = visibleHistory
    .map((entry) => {
      const started = new Date(entry.startedAt).toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const direction = entry.role === "viewer" ? BromeoI18n.t("history.outgoing") : BromeoI18n.t("history.incoming");
      const mode = entry.viewOnly ? BromeoI18n.t("session.viewOnlyBadge") : BromeoI18n.t("history.control");
      const permissions = permissionsSummary(normalizePermissions(entry.permissions, entry.viewOnly));
      const duration = formatDuration(entry.durationSec);
      const recorded = entry.recorded ? BromeoI18n.t("history.recordedSuffix") : "";
      const note = entry.note ? `<div class="history-note">${escapeHtml(entry.note)}</div>` : "";
      return `<div class="history-row">
        <div class="history-main">
          <strong>${direction} - ${formatId(entry.peerId)}</strong>
          <span>${started} | ${duration} | ${mode} | ${permissions} | ${BromeoI18n.t("msg.filesCountShort", { count: entry.filesTransferred })}${recorded}</span>
          ${note}
        </div>
      </div>`;
    })
    .join("");
  const overflowNote = history.length > visibleHistory.length
    ? `<p class="muted small session-history-overflow">${BromeoI18n.t("history.overflowNote", { shown: visibleHistory.length, total: history.length })}</p>`
    : "";
  el.sessionHistoryList.innerHTML = rows + overflowNote;
}

function saveSessionHistoryEntry(entry: SessionHistoryEntry): void {
  const history = getSessionHistory();
  history.unshift(entry);
  setSessionHistory(history);
  renderSessionHistory();
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

async function maybeSaveDeviceAfterConnect(targetId: string): Promise<void> {
  if (!el.rememberDevice.checked || lastConnectAttempt?.targetId !== targetId) return;
  const label = el.rememberLabel.value.trim() || formatId(targetId);
  const group = el.rememberGroup.value.trim() || undefined;
  const macInput = el.rememberMac.value.trim();
  const macValid = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(macInput);
  if (macInput && !macValid) toast(BromeoI18n.t("msg.macIgnored"));
  const existing = savedDevices.find((d) => d.id === targetId);
  savedDevices = await window.bromeo.saveDevice({
    id: targetId,
    label,
    passwordHash: lastConnectAttempt.passwordHash,
    viewOnly: lastConnectAttempt.viewOnly,
    permissions: lastConnectAttempt.permissions,
    mac: macValid ? macInput : undefined,
    group,
    favorite: existing?.favorite ?? false,
  });
  renderSavedDevices();
  el.rememberDevice.checked = false;
  el.rememberLabel.value = "";
  el.rememberLabel.classList.add("hidden");
  el.rememberGroup.value = "";
  el.rememberGroup.classList.add("hidden");
  el.rememberMac.value = "";
  el.rememberMac.classList.add("hidden");
  toast(BromeoI18n.t("msg.deviceSavedOneTap", { label }));
}

function onServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      myId = msg.id;
      el.myId.textContent = formatId(msg.id);
      el.overviewId.textContent = formatId(msg.id);
      break;

    case "error":
      toast(msg.message);
      break;

    case "incoming-request":
      handleIncomingRequest(msg.fromId, msg.passwordHash, !!msg.viewOnly, msg.permissions, msg.totpCode, msg.fromLabel, msg.trustDevice);
      break;

    case "connect-response":
      handleConnectResponse(msg.fromId, msg.accept, msg.reason);
      break;

    case "signal":
      handleSignal(msg.fromId, msg.payload);
      break;

    case "peer-disconnected":
      if (currentRole === "host") {
        // Scoped to just the one viewer that left — must not tear down
        // every other connected viewer (see removeHostViewer).
        if (hostViewers.has(msg.peerId)) {
          removeHostViewer(msg.peerId, { sendBye: false, toastMessage: BromeoI18n.t("msg.viewerDisconnected", { label: hostViewers.get(msg.peerId)?.label ?? formatId(msg.peerId) }) });
        }
      } else if (currentSession) {
        toast(BromeoI18n.t("msg.partnerDisconnected"));
        endSession();
      }
      break;

    case "notify":
      handleIncomingNotify(msg.fromId, msg.notification);
      break;

    case "notify-response":
      window.bromeo.sendBridgeDecision(msg.notificationId, msg.decision);
      dismissConfirmIfMatches(msg.notificationId, msg.decision);
      break;
  }
}

// --- Agent notification bridge (e.g. Google Antigravity needing your confirmation) ---

function handleBridgeNotification(notification: NotificationPayload): void {
  const entry: NotifyHistoryEntry = { ...notification, origin: "local" };
  addNotifyHistory(entry);
  // Forwarding is meant as phone-only redirection, not a copy — showing the
  // interactive confirm dialog (or even just a toast) here too meant two
  // places both prompted for the same request, confusing about which one
  // "counts". Still recorded in history either way, just without the
  // popup/toast when it's headed to the phone instead.
  if (notifyForwardId) {
    signaling.send({ type: "notify", targetId: notifyForwardId, fromId: myId, notification });
  } else if (notification.kind === "confirm") {
    enqueueConfirm(entry);
  } else {
    toast(BromeoI18n.t("msg.notifyToast", { source: notification.source, title: notification.title }));
  }
}

function handleIncomingNotify(fromId: string, notification: NotificationPayload): void {
  const entry: NotifyHistoryEntry = { ...notification, origin: "remote", replyTo: fromId };
  addNotifyHistory(entry);
  if (notification.kind === "confirm") enqueueConfirm(entry);
  else toast(BromeoI18n.t("msg.notifyToast", { source: notification.source, title: notification.title }));
}

function addNotifyHistory(entry: NotifyHistoryEntry): void {
  notifyHistory.unshift(entry);
  if (notifyHistory.length > 20) notifyHistory.length = 20;
  if (el.notifyPanel.classList.contains("hidden")) {
    unseenNotifyCount++;
    updateNotifyBadge();
  }
  renderNotifyList();
}

function updateNotifyStatus(id: string, status: "allow" | "deny"): void {
  const entry = notifyHistory.find((n) => n.id === id);
  if (entry) entry.status = status;
  renderNotifyList();
}

function updateNotifyBadge(): void {
  el.notifyBadge.textContent = String(unseenNotifyCount);
  el.notifyBadge.classList.toggle("hidden", unseenNotifyCount === 0);
}

function enqueueConfirm(entry: NotifyHistoryEntry): void {
  confirmQueue.push(entry);
  if (!activeConfirm) showNextConfirm();
}

function showNextConfirm(): void {
  activeConfirm = confirmQueue.shift() ?? null;
  if (!activeConfirm) {
    el.bridgeConfirmModal.classList.add("hidden");
    return;
  }
  el.bridgeConfirmTitle.textContent = activeConfirm.title;
  el.bridgeConfirmSource.textContent = activeConfirm.source;
  el.bridgeConfirmMessage.textContent = activeConfirm.message;
  el.bridgeConfirmView.classList.toggle("hidden", activeConfirm.origin !== "remote");
  if (activeConfirm.command) {
    el.bridgeConfirmCommand.textContent = activeConfirm.command;
    el.bridgeConfirmCommand.classList.remove("hidden");
  } else {
    el.bridgeConfirmCommand.classList.add("hidden");
  }
  if (activeConfirm.riskLevel) {
    el.bridgeConfirmRisk.textContent = riskLabel(activeConfirm.riskLevel);
    el.bridgeConfirmRisk.className = `risk-badge risk-badge--${activeConfirm.riskLevel}`;
  } else {
    el.bridgeConfirmRisk.classList.add("hidden");
  }
  el.bridgeConfirmModal.classList.remove("hidden");
}

function riskLabel(level: "low" | "medium" | "high"): string {
  return { low: BromeoI18n.t("risk.low"), medium: BromeoI18n.t("risk.medium"), high: BromeoI18n.t("risk.high") }[level];
}

function answerActiveConfirm(decision: "allow" | "deny"): void {
  if (!activeConfirm) return;
  const entry = activeConfirm;
  updateNotifyStatus(entry.id, decision);
  if (entry.origin === "local") {
    window.bromeo.sendBridgeDecision(entry.id, decision);
  } else if (entry.replyTo) {
    signaling.send({ type: "notify-response", targetId: entry.replyTo, notificationId: entry.id, decision });
  }
  showNextConfirm();
}

function dismissConfirmIfMatches(id: string, decision: "allow" | "deny"): void {
  updateNotifyStatus(id, decision);
  confirmQueue = confirmQueue.filter((n) => n.id !== id);
  if (activeConfirm?.id === id) showNextConfirm();
}

function renderNotifyList(): void {
  if (notifyHistory.length === 0) {
    el.notifyList.innerHTML = `<p class="muted small">${BromeoI18n.t("topbar.notificationsEmpty")}</p>`;
    return;
  }
  el.notifyList.innerHTML = notifyHistory
    .map((n) => {
      const time = new Date(n.createdAt).toLocaleTimeString(BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB", { hour: "2-digit", minute: "2-digit" });
      const status =
        n.status === "allow"
          ? `<div class="notify-item-status allow">${BromeoI18n.t("notify.confirmed")}</div>`
          : n.status === "deny"
            ? `<div class="notify-item-status deny">${BromeoI18n.t("notify.denied")}</div>`
            : "";
      const risk = n.riskLevel ? `<span class="risk-badge risk-badge--${n.riskLevel}">${riskLabel(n.riskLevel)}</span>` : "";
      const command = n.command ? `<pre class="notify-command">${escapeHtml(n.command)}</pre>` : "";
      return `<div class="notify-item">
        <div class="notify-item-top"><span>${escapeHtml(n.title)}</span><span class="notify-item-time">${time}</span></div>
        <div class="notify-item-source">${escapeHtml(n.source)} ${risk}</div>
        <div class="notify-item-message">${escapeHtml(n.message)}</div>
        ${command}
        ${status}
      </div>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function handleIncomingRequest(
  fromId: string,
  passwordHash: string,
  viewOnly: boolean,
  permissions: SessionPermissions | undefined,
  totpCode?: string,
  fromLabel?: string,
  trustDevice?: boolean
): Promise<void> {
  // Already viewing someone else — unrelated to hosting capacity, stays a
  // hard reject exactly as before.
  if (currentRole === "viewer" && currentSession) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "busy" });
    return;
  }
  // Hosting capacity — see MAX_CONCURRENT_VIEWERS' own comment for why this
  // is capped well below "unlimited" (concurrent hardware encoder sessions).
  // Webinar mode raises the ceiling to WEBINAR_MAX_VIEWERS, accepting more
  // software-encode CPU load in exchange for a real audience size.
  if (currentRole === "host" && hostViewers.size >= (webinarModeActive ? WEBINAR_MAX_VIEWERS : MAX_CONCURRENT_VIEWERS)) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "busy" });
    return;
  }
  if (trustedOnlyConnections && !savedDevices.some((d) => d.id === fromId)) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "not-trusted" });
    const name = fromLabel?.trim();
    toast(BromeoI18n.t("msg.unknownDeviceRejected", { name: name ? `: ${name}` : "" }));
    return;
  }
  const check = await window.bromeo.checkPassword(passwordHash, totpCode, fromId, fromLabel, trustDevice);
  if (!check.ok) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: check.reason ?? "bad-password" });
    return;
  }
  // A second (or third) viewer joining an already-active hosting session is
  // always forced to view-only, regardless of what it requested — phase 1
  // deliberately never has more than one controlling viewer at a time, see
  // the plan doc referenced above.
  const isExtra = currentRole === "host" && hostViewers.size >= 1;
  const normalizedPermissions = isExtra ? normalizePermissions(permissions, true) : normalizePermissions(permissions, viewOnly);
  if (check.mode === "unattended") {
    acceptIncoming(fromId, !normalizedPermissions.control, normalizedPermissions, isExtra, fromLabel);
    return;
  }
  pendingIncomingQueue.push({ fromId, viewOnly: !normalizedPermissions.control, permissions: normalizedPermissions, isExtra, fromLabel });
  if (pendingIncomingQueue.length === 1) showNextIncomingRequest();
}

function showNextIncomingRequest(): void {
  const next = pendingIncomingQueue[0];
  if (!next) {
    el.incomingModal.classList.add("hidden");
    return;
  }
  const known = savedDevices.find((d) => d.id === next.fromId);
  const name = next.fromLabel?.trim() || known?.label;
  el.incomingFrom.textContent = name ? `${name} (${formatId(next.fromId)})` : formatId(next.fromId);
  el.incomingAction.textContent = next.isExtra
    ? BromeoI18n.t("msg.incomingExtraViewer")
    : BromeoI18n.t("msg.incomingWithPermissions", { perms: permissionsSummary(next.permissions) });
  startIncomingTimeout();
  el.incomingModal.classList.remove("hidden");
}

function respondToIncoming(accept: boolean): void {
  clearIncomingTimeout();
  const next = pendingIncomingQueue.shift();
  if (!next) {
    el.incomingModal.classList.add("hidden");
    return;
  }
  if (accept) acceptIncoming(next.fromId, next.viewOnly, next.permissions, next.isExtra);
  else signaling.send({ type: "connect-response", targetId: next.fromId, accept: false, reason: "declined" });
  showNextIncomingRequest();
}

function acceptIncoming(fromId: string, viewOnly: boolean, permissions: SessionPermissions, isExtra: boolean, label?: string): void {
  signaling.send({ type: "connect-response", targetId: fromId, accept: true });
  if (isExtra) startHostViewerConnection(fromId, label, permissions, viewOnly);
  else startHostSession(fromId, viewOnly, permissions, label);
}

// --- Multi-viewer broadcast helpers (host role) ---

// Sends a system command to every currently connected viewer — for things
// that describe shared capture state (new dimensions, cursor shape, the
// viewer list itself), not a reply to one specific viewer's request.
// excludePeerId skips one viewer — used to relay an annotation stroke to
// everyone EXCEPT whoever drew it (they already rendered it locally).
function broadcastSystemCommand(cmd: SystemCommand, excludePeerId?: string): void {
  for (const v of hostViewers.values()) {
    if (v.peerId === excludePeerId) continue;
    v.session.sendSystemCommand(cmd);
  }
}

function broadcastViewerList(): void {
  const viewers = [...hostViewers.values()].map((v) => ({ label: v.label, viewOnly: v.viewOnly }));
  broadcastSystemCommand({ kind: "viewer-list", viewers });
}

// Swaps the shared capture stream on every connected viewer's PeerSession
// (monitor/window switch, dual-window crop change, resolution-preference
// change, ...). PeerSession.replaceVideoTrack() deliberately no longer stops
// the old stream's tracks itself (see session.ts) — that's this function's
// job, done exactly once after every viewer has swapped over, not per-call.
// stopOld=false is for the webcam-overlay case specifically: the "old"
// stream there is the raw screen capture the compositor is actively
// drawing from (see toggleWebcamOverlay), not something genuinely being
// discarded — stopping it would freeze the overlay's background.
async function broadcastVideoSwap(newStream: MediaStream, stopOld = true): Promise<void> {
  const old = hostCaptureStream;
  hostCaptureStream = newStream;
  await Promise.all([...hostViewers.values()].map((v) => v.session.replaceVideoTrack(newStream)));
  if (stopOld && old && old !== newStream) old.getTracks().forEach((t) => t.stop());
}

function updateSharingStatusUI(): void {
  if (hostViewers.size === 0) return;
  const names = [...hostViewers.values()].map((v) => `${v.label}${v.viewOnly ? BromeoI18n.t("msg.viewerReadOnlySuffix") : ""}`);
  el.sharingText.textContent =
    hostViewers.size === 1
      ? BromeoI18n.t("msg.viewerWatchingSingle", { name: names[0] })
      : BromeoI18n.t("msg.viewersConnected", { count: hostViewers.size, names: names.join(", ") });
}

function saveHostViewerHistoryEntry(entry: HostViewerConnection): void {
  const durationSec = Math.round((Date.now() - entry.connectedAt) / 1000);
  saveSessionHistoryEntry({
    id: crypto.randomUUID(),
    peerId: entry.peerId,
    role: "host",
    startedAt: entry.connectedAt,
    endedAt: Date.now(),
    durationSec,
    viewOnly: entry.viewOnly,
    permissions: entry.permissions,
    // filesTransferredCount is tracked session-wide, not per-viewer, in
    // phase 1 — attributed to the controlling viewer's entry only.
    filesTransferred: entry.isFirstViewer ? filesTransferredCount : 0,
    note: entry.isFirstViewer ? el.sessionNotesInput.value.trim() : "",
    recorded: entry.isFirstViewer ? sessionWasRecorded : false,
  });
}

// Extra (view-only) viewers' chat messages don't get their own dedicated
// thread/UI in phase 1 (see plan doc) — surfaced as a toast so they're never
// silently lost, without building a full multi-thread chat switcher.
function receiveExtraViewerChatMessage(peerId: string, label: string, text: string, _timestamp: number): void {
  toast(BromeoI18n.t("msg.viewerChat", { label, text }));
}

// Host-machine-wide teardown — runs exactly once, when the last connected
// viewer (controlling or extra) disconnects. Everything here describes the
// state of the physical host machine (capture, curtain mode, block-input,
// wallpaper, lock-on-end), not any one viewer's connection.
function finishHostSharing(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
  window.bromeo.hideMiniController();
  stopSessionClock();
  stopIdleTimer();
  stopCursorShapePoll();
  stopHostMicrophone();
  // No viewers left to push a swap to at this point (finishHostSharing only
  // runs once hostViewers is empty) — stop directly instead of going
  // through disableWebcamOverlay's broadcastVideoSwap. rawScreenStream is a
  // *different* object from hostCaptureStream while the overlay is active
  // (the composited canvas stream), so it needs its own explicit stop or
  // it'd keep capturing in the background.
  hostWebcamStream?.getTracks().forEach((t) => t.stop());
  hostWebcamStream = null;
  rawScreenStreamBehindOverlay?.getTracks().forEach((t) => t.stop());
  rawScreenStreamBehindOverlay = null;
  el.hostCameraToggleBtn.classList.remove("btn-primary");
  el.hostCameraToggleBtn.classList.add("btn-outline");
  if (monitorIsOff) {
    window.bromeo.setMonitorPower(true);
    monitorIsOff = false;
  }
  if (inputBlocked) {
    window.bromeo.blockInput(false);
    inputBlocked = false;
  }
  if (wallpaperHidden) {
    window.bromeo.hideWallpaper(false);
    wallpaperHidden = false;
  }
  if (lockOnSessionEnd) window.bromeo.lockComputer();
  lockOnSessionEnd = false;
  window.bromeo.setCaptureDesktop();
  hostCaptureStream?.getTracks().forEach((t) => t.stop());
  hostCaptureStream = null;
  rawDualCaptureStream = null;
  lastDualCropBounds = null;
  if (activeCropAnimFrame) {
    cancelAnimationFrame(activeCropAnimFrame);
    activeCropAnimFrame = null;
  }
  stopDualMonitorRawStreams();
  currentSession = null;
  currentPeerId = null;
  currentRole = null;
  sessionPermissions = defaultPermissions(false);
  sessionViewOnly = false;
  sessionStartedAt = null;
  filesTransferredCount = 0;
  el.curtainManualToggle.classList.add("hidden");
  el.curtainManualToggle.textContent = BromeoI18n.t("sharingBar.curtainOff");
  el.sharingBar.classList.add("hidden");
  el.hostChatPanel.classList.add("hidden");
  el.hostChatMessages.innerHTML = `<p class="muted small">${BromeoI18n.t("session.noMessages")}</p>`;
  el.hostChatInput.value = "";
  el.sessionNotesInput.value = "";
  el.notesPanel.classList.add("hidden");
  el.filesPanel.classList.add("hidden");
  el.filesList.innerHTML = "";
  chatLog = [];
  el.home.classList.remove("hidden");
}

// Removes one viewer (controlling or extra) from an active hosting session.
// If it was the last one, cascades into finishHostSharing(). Never stops the
// shared capture stream directly — that's finishHostSharing's job, and only
// once nothing references the stream anymore.
function removeHostViewer(peerId: string, opts: { sendBye: boolean; toastMessage?: string }): void {
  const entry = hostViewers.get(peerId);
  if (!entry) return;
  hostViewers.delete(peerId);
  stopHostSideVoiceStream(peerId);
  if (opts.sendBye) signaling.send({ type: "bye", targetId: peerId });
  entry.session.close(false);
  saveHostViewerHistoryEntry(entry);
  if (opts.toastMessage) toast(opts.toastMessage);
  if (hostViewers.size === 0) {
    finishHostSharing();
    return;
  }
  if (entry.permissions.control) {
    // No auto-promotion when the controller disconnects — remaining
    // viewers stay view-only until the host explicitly promotes one of
    // them (see promoteViewerToControl) or hosting fully stops.
    currentSession = null;
    currentPeerId = null;
    sessionPermissions = defaultPermissions(false);
    sessionViewOnly = false;
    stopCursorShapePoll();
  }
  broadcastViewerList();
  updateMiniController();
  updateSharingStatusUI();
}

// Hands control to a different, currently-connected, non-controlling
// viewer. Demotes whoever had it (if anyone), promotes the target, keeps
// the module-level "controlling viewer" mirror (currentSession/
// sessionPermissions/...) in sync since several other host-side helpers
// (sendHostClipboard, the "main" chat thread, miniControllerState's
// canClipboard, lock-on-session-end) still read that mirror rather than
// hostViewers directly, and notifies both affected viewers live via
// "permissions-update" so their own UI updates without a reconnect.
function promoteViewerToControl(peerId: string): void {
  const target = hostViewers.get(peerId);
  if (!target || target.permissions.control) return;
  const previous = getControllingViewer();
  if (previous) {
    previous.permissions = { ...previous.permissions, control: false };
    previous.viewOnly = true;
    previous.session.sendSystemCommand({ kind: "permissions-update", permissions: previous.permissions });
  }
  target.permissions = { ...target.permissions, control: true };
  target.viewOnly = false;
  target.session.sendSystemCommand({ kind: "permissions-update", permissions: target.permissions });
  currentSession = target.session;
  currentPeerId = target.peerId;
  sessionPermissions = target.permissions;
  sessionViewOnly = false;
  startCursorShapePoll();
  toast(BromeoI18n.t("msg.controlGivenTo", { label: target.label }));
  broadcastViewerList();
  updateMiniController();
  updateSharingStatusUI();
}

// Shared onConnectionState handler for every host-side viewer, controlling
// or extra. Only the controlling viewer's *first* connect triggers the
// once-per-hosting-session setup (curtain mode, cursor-shape polling,
// sending the monitor list) — an extra viewer joining later must not redo
// any of that.
function onHostViewerConnectionState(peerId: string, state: RTCPeerConnectionState): void {
  const entry = hostViewers.get(peerId);
  if (!entry) return;
  if (state === "connected") {
    updateSharingStatusUI();
    if (entry.isFirstViewer) {
      el.sharingBar.classList.remove("hidden");
      el.curtainManualToggle.classList.remove("hidden");
      window.bromeo.listMonitors().then((monitors) => {
        if (monitors.length > 1) entry.session.sendSystemCommand({ kind: "monitor-list", monitors });
      });
      if (curtainModeEnabled) {
        monitorIsOff = true;
        window.bromeo.setMonitorPower(false);
        el.curtainManualToggle.textContent = BromeoI18n.t("msg.screenOn");
      }
      // Only worth polling if the primary viewer can actually act on hover
      // context — matches the original single-viewer behavior.
      if (!sessionViewOnly) startCursorShapePoll();
    }
    const miniState = miniControllerState();
    if (miniState) {
      // showMiniController animates the window in and is only meaningful
      // once per hosting session; updateMiniController just refreshes an
      // already-open window's content for every viewer after the first.
      if (entry.isFirstViewer) window.bromeo.showMiniController(miniState);
      else window.bromeo.updateMiniController(miniState);
    }
    broadcastViewerList();
    // If the host's mic was already on before this viewer joined, give them
    // the same shared track too — otherwise they'd join a live intercom
    // silent-to-them until someone happened to toggle the mic again.
    if (hostMicStream) void entry.session.setMicrophoneTrack(hostMicStream.getAudioTracks()[0]);
  } else if (state === "closed") {
    // Not "failed" — a "failed"/"disconnected" blip can still self-heal
    // natively (no active recovery attempts on either side anymore, see
    // session.ts), so the host waits for the viewer's own short grace-period
    // close (producing this "closed" state) before tearing down, instead of
    // reacting to the first "failed" blip.
    removeHostViewer(peerId, { sendBye: false, toastMessage: BromeoI18n.t("msg.viewerDisconnected", { label: entry.label }) });
  }
}

// Reuses the shared hostCaptureStream for every viewer after the first —
// only actually calls getDisplayMedia() once per hosting session.
async function captureAndAnswerForViewer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
  const entry = hostViewers.get(peerId);
  if (!entry) return;
  try {
    if (!hostCaptureStream) {
      hostCaptureStream = await navigator.mediaDevices.getDisplayMedia({
        video: getCaptureVideoConstraints(),
        // System audio via Electron's loopback capture (see setupDisplayMediaHandler
        // in main.ts) — falls back to silent video-only if the OS/session can't
        // supply a loopback track, getDisplayMedia doesn't reject for that.
        // Only captured once per hosting session, same as the video track.
        audio: true,
      });
    }
    await entry.session.acceptAsHost(offer, hostCaptureStream);
  } catch (err) {
    toast(BromeoI18n.t("msg.screenShareFailed", { error: (err as Error).message }));
    removeHostViewer(peerId, { sendBye: true });
  }
}

// Constructs a new, always-view-only PeerSession for an additional viewer
// joining an already-active hosting session. Deliberately does not reuse
// startHostSession's callback set: an extra viewer can never have control,
// so every control-gated command is unreachable for it by construction —
// only the handful of genuinely per-connection, non-shared-state commands
// (own bitrate cap, own zoom-sharpness bias, window-list read) are handled.
// Shared callback set for EVERY host-side viewer connection, whether it's
// the first to connect or an additional one, and whether it currently has
// control or not. Every check reads hostViewers.get(peerId) fresh instead
// of a captured value, so a live promotion/demotion (see
// promoteViewerToControl) takes effect immediately without needing to
// reconstruct the PeerSession or swap out callbacks.
function buildHostViewerCallbacks(peerId: string, displayLabel: string): SessionCallbacks {
  return {
    onConnectionState: (state) => onHostViewerConnectionState(peerId, state),
    onVoiceStream: (stream) => playHostSideVoiceStream(peerId, stream),
    // Enforced host-side, not just hidden in the viewer's UI — a
    // non-controlling connection must never be able to move the mouse or
    // type on this machine.
    onInputEvent: (event) => {
      if (hostViewers.get(peerId)?.permissions.control) window.bromeo.applyInput(event);
    },
    onClipboard: async (text) => {
      if (!hostViewers.get(peerId)?.permissions.clipboard) {
        toast(BromeoI18n.t("msg.clipboardRejectedPermissions"));
        return;
      }
      await window.bromeo.setClipboard(text);
      toast(BromeoI18n.t("msg.clipboardReceivedFrom", { label: displayLabel, count: text.length }));
    },
    onChatMessage: (text, timestamp) => {
      if (hostViewers.get(peerId)?.permissions.control) receiveChatMessage(text, timestamp);
      else receiveExtraViewerChatMessage(peerId, displayLabel, text, timestamp);
    },
    onSystemCommand: (cmd) => void handleHostSystemCommand(peerId, cmd),
    onFileOffer: (offer) => {
      if (!hostViewers.get(peerId)?.permissions.files) {
        toast(BromeoI18n.t("msg.fileRejectedPermissions", { name: offer.name }));
        return false;
      }
      addFileRow(offer.id, offer.name);
    },
    onFileProgress: (id, received, total) => {
      if (hostViewers.get(peerId)?.permissions.files) updateFileRow(id, received, total);
    },
    onFileComplete: async (id, name, chunks) => {
      if (!hostViewers.get(peerId)?.permissions.files) return;
      const res = await window.bromeo.saveFile(name, chunks);
      filesTransferredCount++;
      finishFileRow(id, res.ok ? BromeoI18n.t("msg.fileSaved", { path: res.path ?? "" }) : BromeoI18n.t("msg.saveCancelled"));
    },
  };
}

// The single onSystemCommand implementation for every host-side viewer.
// Gated per-command on that specific viewer's *current* control permission
// (not a fixed "is this the primary connection" flag), so promotion/demotion
// takes effect on the very next command without any reconnect.
async function handleHostSystemCommand(peerId: string, cmd: SystemCommand): Promise<void> {
  const entry = hostViewers.get(peerId);
  if (!entry) return;
  const control = entry.permissions.control;
  if (cmd.kind === "restart-request") {
    if (control) window.bromeo.restartComputer();
  } else if (cmd.kind === "lock-request") {
    if (control) window.bromeo.lockComputer();
  } else if (cmd.kind === "lock-on-session-end") {
    lockOnSessionEnd = control && cmd.enabled;
    entry.session.sendSystemCommand({ kind: "lock-on-session-end-status", enabled: lockOnSessionEnd, ok: control });
  } else if (cmd.kind === "quality-request") {
    // "auto" hands the bitrate cap to the continuous network-adaptive
    // engine (see setAdaptiveQuality/updateAdaptiveBitrate in session.ts)
    // instead of just uncapping it forever; "high"/"low" are fixed manual
    // overrides. Not control-gated — each viewer's own bitrate cap only
    // affects their own PeerSession/sender, no shared state.
    entry.session.setAdaptiveQuality(cmd.level === "auto");
    if (cmd.level !== "auto") await entry.session.setVideoBitrate(QUALITY_BITRATE_KBPS[cmd.level]);
  } else if (cmd.kind === "resolution-preference") {
    // Control-gated — this re-captures the *shared* stream every connected
    // viewer sees (see broadcastVideoSwap below), so a non-controlling
    // viewer must not be able to degrade the controller's picture by
    // toggling their own local preference.
    if (!control) return;
    if (captureResolutionMode === cmd.mode) return;
    captureResolutionMode = cmd.mode;
    if (hostWebcamStream) {
      await disableWebcamOverlay();
      toast(BromeoI18n.t("msg.cameraOverlayOffResolution"));
    }
    // Re-capture whatever is currently active (window/monitor/dual — that
    // selection lives in main.ts and setDisplayMediaRequestHandler picks it
    // automatically, independent of these constraints) at the new
    // resolution, same mechanism as switch-window/switch-monitor use. Only
    // do this once a capture is actually running — if this arrives before
    // the initial captureAndAnswerForViewer() (e.g. the viewer's stored
    // preference sent right after connecting), the initial capture will
    // just read the now-updated captureResolutionMode itself.
    if (!entry.session.hasCaptureStream()) return;
    if (rawDualCaptureStream) {
      rawDualCaptureStream = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
      const finalStream = lastDualCropBounds ? createCroppedStream(rawDualCaptureStream, lastDualCropBounds) : rawDualCaptureStream;
      await broadcastVideoSwap(finalStream);
      if (lastDualCropBounds) {
        broadcastSystemCommand({ kind: "video-dimensions", width: lastDualCropBounds.width, height: lastDualCropBounds.height });
      }
    } else {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
      await broadcastVideoSwap(stream);
      const track = stream.getVideoTracks()[0];
      if (track) {
        let attempts = 0;
        const timer = setInterval(() => {
          const settings = track.getSettings();
          if (settings.width && settings.height) {
            clearInterval(timer);
            broadcastSystemCommand({ kind: "video-dimensions", width: settings.width, height: settings.height });
          } else if (++attempts > 40) {
            clearInterval(timer);
          }
        }, 50);
      }
    }
  } else if (cmd.kind === "zoom-state") {
    entry.session.setZoomedIn(cmd.zoomedIn);
  } else if (cmd.kind === "block-input") {
    if (control) {
      const applied = await window.bromeo.blockInput(cmd.enabled);
      inputBlocked = cmd.enabled ? applied : false;
      entry.session.sendSystemCommand({ kind: "block-input-status", enabled: inputBlocked, ok: cmd.enabled ? applied : true });
    }
  } else if (cmd.kind === "hide-wallpaper") {
    if (control) {
      const applied = await window.bromeo.hideWallpaper(cmd.enabled);
      wallpaperHidden = cmd.enabled ? applied : false;
      entry.session.sendSystemCommand({ kind: "hide-wallpaper-status", enabled: wallpaperHidden, ok: cmd.enabled ? applied : true });
    }
  } else if (cmd.kind === "ctrl-alt-del-request") {
    if (control) {
      const ok = await window.bromeo.sendCtrlAltDel();
      const installed = ok || (await window.bromeo.sasStatus());
      entry.session.sendSystemCommand({ kind: "ctrl-alt-del-status", ok, installed });
    }
  } else if (
    cmd.kind === "switch-monitor" ||
    cmd.kind === "switch-window" ||
    cmd.kind === "switch-dual-window" ||
    cmd.kind === "resize-dual-window" ||
    cmd.kind === "switch-to-desktop"
  ) {
    if (!control) return;
    // Any of these leave dual-monitor mode (if it was active) — release
    // both raw per-monitor captures rather than leaving them running
    // unused in the background. A harmless no-op if it wasn't active.
    stopDualMonitorRawStreams();
    // The webcam overlay composites onto a *specific* raw screen stream
    // (see toggleWebcamOverlay) — switching monitor/window changes what's
    // actually being captured out from under it, so turn it off rather
    // than silently composite onto a now-stale/wrong source. One tap to
    // turn back on after the switch.
    if (hostWebcamStream) {
      await disableWebcamOverlay();
      toast(BromeoI18n.t("msg.cameraOverlayOffSwitch"));
    }

    if (cmd.kind === "switch-monitor") {
      rawDualCaptureStream = null;
      await window.bromeo.setActiveMonitor(cmd.monitorId);
    } else if (cmd.kind === "switch-window") {
      rawDualCaptureStream = null;
      await window.bromeo.setActiveWindow(cmd.windowId, cmd.aspect);
    } else if (cmd.kind === "switch-dual-window") {
      // tileDualWindows (main.ts) tiles the two windows inside an
      // aspect-locked box, not the raw (monitor-shaped) work area, and
      // returns that box's bounds — but the actual capture is still the
      // *whole* monitor (there's no single HWND to point desktopCapturer at
      // when two windows are involved, see setDisplayMediaRequestHandler).
      // Cropping the raw capture down to exactly that box is what makes the
      // final video "locked" to just the two windows, matching how
      // single-window mode is already naturally cropped to one window by
      // Chromium itself.
      const bounds = await window.bromeo.setDualWindow(cmd.windowId1, cmd.windowId2, cmd.aspect, cmd.isPortrait);
      lastDualCropBounds = bounds;
      rawDualCaptureStream = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
      const finalStream = bounds ? createCroppedStream(rawDualCaptureStream, bounds) : rawDualCaptureStream;
      await broadcastVideoSwap(finalStream);
      if (bounds) broadcastSystemCommand({ kind: "video-dimensions", width: bounds.width, height: bounds.height });
      return;
    } else if (cmd.kind === "resize-dual-window") {
      // Fired on every phone rotation while dual-window mode is active. The
      // underlying monitor capture doesn't need to change, only the crop
      // region does — re-crop the existing raw capture instead of
      // requesting a brand new one.
      const bounds = await window.bromeo.resizeDualWindow(cmd.aspect, cmd.isPortrait);
      if (bounds) lastDualCropBounds = bounds;
      if (bounds && rawDualCaptureStream) {
        const finalStream = createCroppedStream(rawDualCaptureStream, bounds);
        await broadcastVideoSwap(finalStream);
        broadcastSystemCommand({ kind: "video-dimensions", width: bounds.width, height: bounds.height });
      }
      return;
    } else if (cmd.kind === "switch-to-desktop") {
      if (activeCropAnimFrame) {
        cancelAnimationFrame(activeCropAnimFrame);
        activeCropAnimFrame = null;
      }
      rawDualCaptureStream = null;
      await window.bromeo.setCaptureDesktop();
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
    await broadcastVideoSwap(stream);

    // Robustly fetch and send the new dimensions as soon as they are available.
    const track = stream.getVideoTracks()[0];
    if (track) {
      let attempts = 0;
      const timer = setInterval(() => {
        const settings = track.getSettings();
        if (settings.width && settings.height) {
          clearInterval(timer);
          broadcastSystemCommand({ kind: "video-dimensions", width: settings.width, height: settings.height });
        } else if (++attempts > 40) {
          clearInterval(timer); // give up after 2s
        }
      }, 50);
    }
  } else if (cmd.kind === "switch-dual-monitor") {
    if (!control) return;
    stopDualMonitorRawStreams();
    if (hostWebcamStream) {
      await disableWebcamOverlay();
      toast(BromeoI18n.t("msg.cameraOverlayOffSwitch"));
    }
    await window.bromeo.setActiveMonitor(cmd.monitorId1);
    const streamA = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
    await window.bromeo.setActiveMonitor(cmd.monitorId2);
    const streamB = await navigator.mediaDevices.getDisplayMedia({ video: getCaptureVideoConstraints(), audio: false });
    dualMonitorStreams = { a: streamA, b: streamB };
    const composited = createDualMonitorStream(streamA, streamB, cmd.aspect, cmd.isPortrait);
    await broadcastVideoSwap(composited);
    broadcastSystemCommand({ kind: "video-dimensions", width: composited.getVideoTracks()[0].getSettings().width ?? 0, height: composited.getVideoTracks()[0].getSettings().height ?? 0 });
  } else if (cmd.kind === "resize-dual-monitor") {
    if (!control || !dualMonitorStreams) return;
    if (hostWebcamStream) {
      await disableWebcamOverlay();
      toast(BromeoI18n.t("msg.cameraOverlayOffSwitch"));
    }
    // Fired on every phone rotation — recompose the already-captured pair
    // at the new split, no fresh getDisplayMedia calls needed (mirrors
    // resize-dual-window's re-crop-without-recapture approach).
    const composited = createDualMonitorStream(dualMonitorStreams.a, dualMonitorStreams.b, cmd.aspect, cmd.isPortrait);
    await broadcastVideoSwap(composited);
    broadcastSystemCommand({ kind: "video-dimensions", width: composited.getVideoTracks()[0].getSettings().width ?? 0, height: composited.getVideoTracks()[0].getSettings().height ?? 0 });
  } else if (cmd.kind === "window-list-request") {
    const windows = await window.bromeo.listWindows();
    entry.session.sendSystemCommand({ kind: "window-list", windows });
  } else if (cmd.kind === "resize-active-window") {
    if (control) await window.bromeo.resizeActiveWindow(cmd.aspect);
  } else if (cmd.kind === "annotation-shape" || cmd.kind === "annotation-erase" || cmd.kind === "annotation-clear") {
    // This relays a *viewer*-originated shape to every other connected
    // viewer (the host's own shapes go out via broadcastSystemCommand
    // directly from onHostAnnotationShape, never through here). Any viewer
    // can draw regardless of control, so this is deliberately not gated on
    // `control`.
    broadcastSystemCommand(cmd, peerId);
  }
}

function startHostViewerConnection(peerId: string, label: string | undefined, permissions: SessionPermissions, viewOnly: boolean): void {
  const displayLabel = label?.trim() || savedDevices.find((d) => d.id === peerId)?.label || formatId(peerId);
  const session = new PeerSession("host", DEFAULT_ICE_SERVERS, signaling, peerId, buildHostViewerCallbacks(peerId, displayLabel));
  hostViewers.set(peerId, { session, peerId, label: displayLabel, permissions, viewOnly, isFirstViewer: false, connectedAt: Date.now() });
}

function startHostSession(peerId: string, viewOnly: boolean, permissions = defaultPermissions(viewOnly), label?: string): void {
  currentRole = "host";
  currentPeerId = peerId;
  sessionPermissions = normalizePermissions(permissions, viewOnly);
  sessionViewOnly = !sessionPermissions.control;
  sessionStartedAt = Date.now();
  filesTransferredCount = 0;
  sessionWasRecorded = false;
  startSessionClock();
  const displayLabel = label?.trim() || savedDevices.find((d) => d.id === peerId)?.label || formatId(peerId);
  currentSession = new PeerSession("host", DEFAULT_ICE_SERVERS, signaling, peerId, buildHostViewerCallbacks(peerId, displayLabel));
  hostViewers.set(peerId, {
    session: currentSession,
    peerId,
    label: displayLabel,
    permissions: sessionPermissions,
    viewOnly: sessionViewOnly,
    isFirstViewer: true,
    connectedAt: sessionStartedAt,
  });
}

// Not started for view-only sessions — there's no point mirroring cursor
// shape when the viewer can't act on hover context anyway, and it's one
// less native poll running for no benefit. Broadcast to every connected
// viewer, controlling or extra — the cursor overlay matters to whoever's
// watching, not just whoever's driving.
function startCursorShapePoll(): void {
  stopCursorShapePoll();
  lastSentCursorShape = null;
  cursorShapePollTimer = setInterval(async () => {
    const shape = await window.bromeo.getCursorShape();
    if (shape === lastSentCursorShape) return;
    lastSentCursorShape = shape;
    broadcastSystemCommand({ kind: "cursor-shape", shape });
  }, CURSOR_SHAPE_POLL_INTERVAL_MS);
}

function stopCursorShapePoll(): void {
  if (cursorShapePollTimer) clearInterval(cursorShapePollTimer);
  cursorShapePollTimer = null;
  lastSentCursorShape = null;
}

function handleConnectResponse(fromId: string, accept: boolean, reason?: string): void {
  if (accept) {
    maybeSaveDeviceAfterConnect(fromId);
    const permissions = lastConnectAttempt?.targetId === fromId ? lastConnectAttempt.permissions : defaultPermissions(false);
    startViewerSession(fromId, !permissions.control, permissions);
    return;
  }
  el.connectStatus.textContent = "";
  if (reason === "totp-required" || reason === "bad-totp") {
    el.totpRequiredMessage.textContent =
      reason === "bad-totp"
        ? BromeoI18n.t("msg.totpBadCodeRetry")
        : BromeoI18n.t("totpRequired.message");
    el.totpRequiredInput.value = "";
    el.totpTrustDevice.checked = false;
    el.totpRequiredModal.classList.remove("hidden");
    return;
  }
  const reasons: Record<string, string> = {
    offline: BromeoI18n.t("reason.offline"),
    "bad-password": BromeoI18n.t("reason.badPassword"),
    declined: BromeoI18n.t("reason.declined"),
    "not-trusted": BromeoI18n.t("reason.notTrusted"),
    busy: BromeoI18n.t("reason.busy"),
  };
  toast(reasons[reason ?? ""] ?? BromeoI18n.t("reason.generic"));
}

// Toggles the viewer-role toolbar affordances to match a permission set.
// Called at session start AND whenever the host sends a live
// "permissions-update" (e.g. a multi-viewer-hosting promotion/demotion —
// see promoteViewerToControl in the host-side code above), so a mid-session
// permission change is immediately visible without a reconnect.
function applyViewerPermissionsUi(permissions: SessionPermissions, viewOnly: boolean): void {
  el.viewOnlyBadge.classList.toggle("hidden", !viewOnly);
  el.textToggleBtn.classList.toggle("hidden", !permissions.control);
  el.shortcutsToggleBtn.classList.toggle("hidden", !permissions.control);
  el.restartBtn.classList.toggle("hidden", !permissions.control);
  el.lockBtn.classList.toggle("hidden", !permissions.control);
  el.lockOnEndBtn.classList.toggle("hidden", !permissions.control);
  el.blockInputBtn.classList.toggle("hidden", !permissions.control);
  el.ctrlAltDelBtn.classList.toggle("hidden", !permissions.control);
  el.clipboardBtn.classList.toggle("hidden", !permissions.clipboard);
  el.filesToggleBtn.classList.toggle("hidden", !permissions.files);
}

function startViewerSession(peerId: string, viewOnly: boolean, permissions = defaultPermissions(viewOnly)): void {
  currentRole = "viewer";
  currentPeerId = peerId;
  sessionPermissions = normalizePermissions(permissions, viewOnly);
  sessionViewOnly = !sessionPermissions.control;
  sessionStartedAt = Date.now();
  filesTransferredCount = 0;
  sessionWasRecorded = false;
  startSessionClock();
  startIdleTimer();
  el.sessionPeer.textContent = formatId(peerId);
  applyViewerPermissionsUi(sessionPermissions, sessionViewOnly);
  // Reset to the default (unblocked) look for this fresh session — the
  // previous session's block-input state doesn't carry over.
  setBlockInputUi(false);
  setLockOnEndUi(false);
  updateSessionState("starting");
  el.sessionNotesInput.value = "";
  el.sessionStats.textContent = BromeoI18n.t("session.imageLoading");
  el.sessionHint.classList.remove("hidden");
  remoteAudioMuted = false;
  el.remoteVideo.muted = false;
  setIconButtonState(el.audioToggleBtn, BromeoI18n.t("session.soundOff"), "icon-volume-x");
  el.home.classList.add("hidden");
  el.sessionView.classList.remove("hidden");
  currentSession = new PeerSession("viewer", DEFAULT_ICE_SERVERS, signaling, peerId, {
    onRemoteStream: (stream) => {
      el.remoteVideo.srcObject = stream;
      el.remoteVideo.play().catch(() => {});
      el.sessionStats.textContent = "";
      el.sessionHint.classList.add("hidden");
      applyRemoteFitMode(el.fitModeSelect.value as RemoteFitMode);
      el.videoWrap.tabIndex = 0;
      el.videoWrap.focus();
      if (recordingMode === "auto") startRecording(true);
    },
    onVoiceStream: (stream) => {
      el.voiceAudio.srcObject = stream;
      el.voiceAudio.play().catch(() => {});
    },
    onConnectionState: (state) => {
      updateSessionState(state);
      if (state === "closed") {
        // Auto-reconnect only ever fires for the *explicit* "Herstart
        // verbinding" button (restartRequestedFor), never for an unexpected
        // drop — a surprise "closed" just ends the session and leaves it
        // ended, matching a plain disconnect.
        const reconnectInfo = restartRequestedFor === peerId ? lastConnectAttempt : null;
        restartRequestedFor = null;
        endSession();
        if (reconnectInfo) scheduleAutoReconnect(reconnectInfo.targetId, reconnectInfo.passwordHash, reconnectInfo.viewOnly, reconnectInfo.permissions);
      }
    },
    onStats: (stats) => {
      el.sessionStats.textContent = formatSessionStats(stats);
    },
    onClipboard: async (text) => {
      if (!sessionPermissions.clipboard) {
        toast(BromeoI18n.t("msg.clipboardRejectedPermissions"));
        return;
      }
      await window.bromeo.setClipboard(text);
      toast(BromeoI18n.t("msg.clipboardReceived", { count: text.length }));
    },
    onChatMessage: (text, timestamp) => receiveChatMessage(text, timestamp),
    onSystemCommand: (cmd) => {
      if (cmd.kind === "monitor-list") populateMonitorSelect(cmd.monitors);
      else if (cmd.kind === "block-input-status") {
        // `enabled` here is the host's actual resulting state (not an echo
        // of what we requested), so it's always safe to trust directly —
        // `ok` only controls whether we also surface a failure toast.
        setBlockInputUi(cmd.enabled, false);
        if (!cmd.ok) toast(BromeoI18n.t("msg.blockInputFailedRemote"));
      } else if (cmd.kind === "lock-on-session-end-status") {
        applyLockOnEndStatus(cmd.enabled, cmd.ok);
      } else if (cmd.kind === "ctrl-alt-del-status") {
        if (cmd.ok) toast(BromeoI18n.t("msg.cadSent"));
        else if (!cmd.installed) toast(BromeoI18n.t("msg.cadNotEnabled"));
        else toast(BromeoI18n.t("msg.cadSendFailed"));
      } else if (cmd.kind === "permissions-update") {
        // A multi-viewer-hosting promotion/demotion on the host's side —
        // re-apply our own toolbar UI live instead of requiring a reconnect.
        sessionPermissions = cmd.permissions;
        sessionViewOnly = !sessionPermissions.control;
        applyViewerPermissionsUi(sessionPermissions, sessionViewOnly);
        toast(sessionPermissions.control ? BromeoI18n.t("msg.viewerNowControlling") : BromeoI18n.t("msg.viewerNowReadOnly"));
      } else if (cmd.kind === "annotation-shape") {
        receiveAnnotationShape(cmd.shape);
      } else if (cmd.kind === "annotation-erase") {
        eraseAnnotationShapeLocally(cmd.id);
      } else if (cmd.kind === "annotation-clear") {
        clearAnnotationsLocally();
      }
    },
    onFileOffer: (offer) => {
      if (!sessionPermissions.files) {
        toast(BromeoI18n.t("msg.fileRejectedPermissions", { name: offer.name }));
        return false;
      }
      addFileRow(offer.id, offer.name);
    },
    onFileProgress: (id, received, total) => {
      if (sessionPermissions.files) updateFileRow(id, received, total);
    },
    onFileComplete: async (id, name, chunks) => {
      if (!sessionPermissions.files) return;
      const res = await window.bromeo.saveFile(name, chunks);
      filesTransferredCount++;
      finishFileRow(id, res.ok ? BromeoI18n.t("msg.fileSaved", { path: res.path ?? "" }) : BromeoI18n.t("msg.saveCancelled"));
    },
  });
  currentSession.startAsViewer(el.codecPreferenceSelect.value as CodecPreferenceMode);
  applyQualityLevel(el.qualitySelect.value as QualityLevel);
  applyResolutionPreference(el.resolutionPreferenceSelect.value as ResolutionMode);
  el.connectStatus.textContent = BromeoI18n.t("msg.connectedStatus");
}

function handleSignal(fromId: string, payload: unknown): void {
  const p = payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  if (currentRole === "host") {
    // Dispatch by fromId — with multi-viewer hosting there can be several
    // simultaneously-active PeerSessions, each identified by which viewer
    // it belongs to (see hostViewers, captureAndAnswerForViewer).
    const entry = hostViewers.get(fromId);
    if (!entry) return;
    if (p.candidate) {
      entry.session.addRemoteCandidate(p.candidate);
      return;
    }
    if (p.sdp?.type === "offer") {
      if (entry.session.hasCaptureStream()) entry.session.answerOffer(p.sdp);
      else void captureAndAnswerForViewer(fromId, p.sdp);
    }
    return;
  }
  if (!currentSession) return;
  if (p.candidate) {
    currentSession.addRemoteCandidate(p.candidate);
    return;
  }
  if (p.sdp?.type === "answer" && currentRole === "viewer") {
    currentSession.applyAnswer(p.sdp);
  }
}

// Ends the ENTIRE hosting session (every connected viewer) when called for
// the host role — the panic button / explicit "stop sharing" action, not a
// single viewer leaving (see removeHostViewer for that). Viewer-role
// behavior (leaving a session you're viewing) is unchanged from before
// multi-viewer hosting existed.
function endSession(): void {
  resetAnnotationState();
  resetMicrophoneState();
  if (currentRole === "host") {
    stopHostMicrophone();
    hostWebcamStream?.getTracks().forEach((t) => t.stop());
    hostWebcamStream = null;
    rawScreenStreamBehindOverlay?.getTracks().forEach((t) => t.stop());
    rawScreenStreamBehindOverlay = null;
    el.hostCameraToggleBtn.classList.remove("btn-primary");
    el.hostCameraToggleBtn.classList.add("btn-outline");
    for (const peerId of [...hostViewers.keys()]) {
      const entry = hostViewers.get(peerId);
      if (!entry) continue;
      hostViewers.delete(peerId);
      stopHostSideVoiceStream(peerId);
      signaling.send({ type: "bye", targetId: peerId });
      entry.session.close(false);
      saveHostViewerHistoryEntry(entry);
    }
    hostCaptureStream?.getTracks().forEach((t) => t.stop());
    hostCaptureStream = null;
    rawDualCaptureStream = null;
    lastDualCropBounds = null;
    if (activeCropAnimFrame) {
      cancelAnimationFrame(activeCropAnimFrame);
      activeCropAnimFrame = null;
    }
    stopDualMonitorRawStreams();
    // Nulled here so the generic teardown below (currentPeerId/currentSession
    // bye-send and close(), showSessionSummary()) becomes a safe no-op —
    // per-viewer history and bye-sends already happened in the loop above.
    currentPeerId = null;
    currentSession = null;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
  window.bromeo.hideMiniController();
  showSessionSummary();
  stopSessionClock();
  stopIdleTimer();
  stopCursorShapePoll();
  clearIncomingTimeout();
  pendingIncomingQueue = [];
  el.incomingModal.classList.add("hidden");
  if (monitorIsOff) {
    window.bromeo.setMonitorPower(true);
    monitorIsOff = false;
  }
  // Safety net: never leave the host's own mouse/keyboard blocked once a
  // session ends, however it ends (deliberate hangup, dropped connection,
  // ICE failure, ...) — see the "block-input" case in onSystemCommand above.
  if (inputBlocked) {
    window.bromeo.blockInput(false);
    inputBlocked = false;
  }
  // Same safety net as inputBlocked above — never leave the wallpaper
  // hidden once the session that hid it ends.
  if (wallpaperHidden) {
    window.bromeo.hideWallpaper(false);
    wallpaperHidden = false;
  }
  if (currentRole === "host" && lockOnSessionEnd && !sessionViewOnly) {
    window.bromeo.lockComputer();
  }
  lockOnSessionEnd = false;
  // Safety net, same reasoning as inputBlocked/wallpaperHidden above: a
  // single/dual-window share (and the periodic "keep these windows on top"
  // loop that comes with it — see keepForegroundLoop in main.ts) must never
  // outlive the session that started it, however it ends.
  if (currentRole === "host") window.bromeo.setCaptureDesktop();
  el.curtainManualToggle.classList.add("hidden");
  el.curtainManualToggle.textContent = BromeoI18n.t("sharingBar.curtainOff");

  // Notify the peer immediately rather than letting it wait out a WebRTC
  // ICE-failure timeout (which can take many seconds) to notice we're gone.
  if (currentPeerId) signaling.send({ type: "bye", targetId: currentPeerId });
  currentPeerId = null;

  currentSession?.close();
  currentSession = null;
  currentRole = null;
  sessionPermissions = defaultPermissions(false);
  sessionViewOnly = false;
  el.sharingBar.classList.add("hidden");
  el.sessionView.classList.add("hidden");
  el.viewOnlyBadge.classList.add("hidden");
  el.home.classList.remove("hidden");
  el.filesPanel.classList.add("hidden");
  el.filesList.innerHTML = "";
  el.textPanel.classList.add("hidden");
  el.shortcutsPanel.classList.add("hidden");
  el.notesPanel.classList.add("hidden");
  el.remoteTextInput.value = "";
  el.sessionNotesInput.value = "";
  el.textToggleBtn.classList.remove("hidden");
  el.shortcutsToggleBtn.classList.remove("hidden");
  setBlockInputUi(false);
  setLockOnEndUi(false);
  el.connectStatus.textContent = "";
  el.remoteVideo.srcObject = null;
  el.remoteVideo.muted = false;
  remoteAudioMuted = false;
  setIconButtonState(el.audioToggleBtn, BromeoI18n.t("session.soundOff"), "icon-volume-x");
  el.sessionStats.textContent = BromeoI18n.t("session.imageLoading");
  updateSessionState("starting");
  el.sessionHint.classList.remove("hidden");
  chatLog = [];
  el.chatPanel.classList.add("hidden");
  el.hostChatPanel.classList.add("hidden");
  el.chatMessages.innerHTML = `<p class="muted small">${BromeoI18n.t("session.noMessages")}</p>`;
  el.hostChatMessages.innerHTML = `<p class="muted small">${BromeoI18n.t("session.noMessages")}</p>`;
  el.chatInput.value = "";
  el.hostChatInput.value = "";
  aiBuddyLog = [];
  clearAiBuddyScreenshot();
  el.aiBuddyPanel.classList.add("hidden");
  renderAiBuddyMessages();
  el.restartConfirmModal.classList.add("hidden");
  el.monitorSelect.innerHTML = "";
  el.monitorSelect.classList.add("hidden");
}

function startSessionClock(): void {
  if (sessionDurationHandle) clearInterval(sessionDurationHandle);
  updateSessionDuration();
  sessionDurationHandle = setInterval(updateSessionDuration, 1000);
}

function stopSessionClock(): void {
  if (sessionDurationHandle) clearInterval(sessionDurationHandle);
  sessionDurationHandle = null;
  el.sessionDuration.textContent = "00:00";
}

function updateSessionDuration(): void {
  if (sessionStartedAt == null) {
    el.sessionDuration.textContent = "00:00";
    return;
  }
  const totalSeconds = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    el.sessionDuration.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } else {
    el.sessionDuration.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
}

function showSessionSummary(): void {
  if (sessionStartedAt == null || !currentPeerId || !currentRole) return;
  const durationSec = Math.round((Date.now() - sessionStartedAt) / 1000);
  const endedAt = Date.now();
  const durationText = formatDuration(durationSec);
  const filesText = filesTransferredCount === 0 ? BromeoI18n.t("msg.noFilesTransferred") : BromeoI18n.t("msg.filesTransferredCount", { count: filesTransferredCount });
  saveSessionHistoryEntry({
    id: crypto.randomUUID(),
    peerId: currentPeerId,
    role: currentRole,
    startedAt: sessionStartedAt,
    endedAt,
    durationSec,
    viewOnly: sessionViewOnly,
    permissions: sessionPermissions,
    filesTransferred: filesTransferredCount,
    note: el.sessionNotesInput.value.trim(),
    recorded: sessionWasRecorded,
  });
  toast(BromeoI18n.t("msg.sessionEndedSummary", { duration: durationText, files: filesText }));
  sessionStartedAt = null;
  filesTransferredCount = 0;
}

// --- Session recording (viewer side, records the remote screen you're seeing) ---

function toggleRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
  else startRecording();
}

function startRecording(auto = false): void {
  const stream = el.remoteVideo.srcObject as MediaStream | null;
  if (!stream || currentRole !== "viewer") {
    if (!auto) toast(BromeoI18n.t("msg.recordOnlyDuringSession"));
    return;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const suggestedName = `BromeoRemote-opname-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const res = await window.bromeo.saveRecording(buffer, suggestedName);
    toast(res.ok ? BromeoI18n.t("msg.recordingSaved", { path: res.path ?? "" }) : BromeoI18n.t("msg.recordingSaveCancelled"));
  };
  mediaRecorder.start();
  sessionWasRecorded = true;
  recordingStartedAt = Date.now();
  setIconButtonState(el.recordToggleBtn, BromeoI18n.t("msg.stopRecording"), "icon-stop");
  el.recordingIndicator.classList.remove("hidden");
  recordingTimerHandle = setInterval(updateRecordingTimer, 1000);
  updateRecordingTimer();
  if (auto) toast(BromeoI18n.t("msg.autoRecordingStarted"));
}

function stopRecording(): void {
  mediaRecorder?.stop();
  mediaRecorder = null;
  if (recordingTimerHandle) clearInterval(recordingTimerHandle);
  recordingTimerHandle = null;
  setIconButtonState(el.recordToggleBtn, BromeoI18n.t("session.record"), "icon-record");
  el.recordingIndicator.classList.add("hidden");
}

function updateRecordingTimer(): void {
  const elapsedSec = Math.floor((Date.now() - recordingStartedAt) / 1000);
  const minutes = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const seconds = String(elapsedSec % 60).padStart(2, "0");
  el.recordingTime.textContent = `${minutes}:${seconds}`;
}

// --- In-session chat ---

function sendChatMessage(inputEl: HTMLInputElement): void {
  const text = inputEl.value.trim();
  if (!text) return;
  sendChatText(text);
  inputEl.value = "";
}

// Shared by the main window's chat inputs and the docked host-chat window's
// own input (see onHostChatSend below) — the latter has no <input> element
// living in this document to read from, just a string over IPC.
function sendChatText(text: string): void {
  if (!text || !currentSession) return;
  currentSession.sendChat(text);
  chatLog.push({ text, timestamp: Date.now(), mine: true });
  renderChat();
}

function receiveChatMessage(text: string, timestamp: number): void {
  chatLog.push({ text, timestamp, mine: false });
  renderChat();
  if (currentRole === "host") {
    openHostChatPanel();
  } else {
    [el.filesPanel, el.chatPanel, el.textPanel, el.shortcutsPanel, el.notesPanel, el.aiBuddyPanel].forEach((p) => p.classList.add("hidden"));
    el.chatPanel.classList.remove("hidden");
    el.chatInput.focus();
  }
}

function renderChat(): void {
  const container = currentRole === "host" ? el.hostChatMessages : el.chatMessages;
  if (chatLog.length === 0) {
    container.innerHTML = `<p class="muted small">${BromeoI18n.t("session.noMessages")}</p>`;
    return;
  }
  container.innerHTML = chatLog
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleTimeString(BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB", { hour: "2-digit", minute: "2-digit" });
      return `<div class="chat-bubble ${m.mine ? "chat-bubble--mine" : ""}">${escapeHtml(m.text)}<span class="chat-bubble-time">${time}</span></div>`;
    })
    .join("");
  container.scrollTop = container.scrollHeight;
  if (currentRole === "host") void window.bromeo.updateHostChat(chatLog);
}

// --- AI Buddy (local-only — the user's own OpenAI key, never touches the
// signaling server) ---

// Snapshots the current remote-session <video> frame via an offscreen
// canvas — a real DOM element, trivial to draw and export unlike mobile's
// native SurfaceView-backed RTCView (see mobile/src/aiBuddy.ts's PixelCopy
// native module for that side of the story).
function captureRemoteVideoFrame(): string | null {
  const video = el.remoteVideo;
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = el.aiBuddyCaptureCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function setAiBuddyScreenshot(dataUrl: string): void {
  aiBuddyPendingScreenshot = dataUrl;
  el.aiBuddyScreenshotImg.src = dataUrl;
  el.aiBuddyScreenshotPreview.classList.remove("hidden");
}

function clearAiBuddyScreenshot(): void {
  aiBuddyPendingScreenshot = null;
  el.aiBuddyScreenshotImg.src = "";
  el.aiBuddyScreenshotPreview.classList.add("hidden");
}

function renderAiBuddyMessages(): void {
  if (aiBuddyLog.length === 0) {
    el.aiBuddyMessages.innerHTML =
      `<p class="muted small">${BromeoI18n.t("session.aiBuddyScreenshotHint")}</p>`;
    return;
  }
  el.aiBuddyMessages.innerHTML = aiBuddyLog
    .map((m) => {
      const imageHtml = m.imageBase64 ? `<div class="chat-bubble--ai-buddy-image"><img src="${m.imageBase64}" alt="Screenshot" /></div>` : "";
      return `<div class="chat-bubble ${m.role === "user" ? "chat-bubble--mine" : ""}">${imageHtml}${escapeHtml(m.text)}</div>`;
    })
    .join("");
  el.aiBuddyMessages.scrollTop = el.aiBuddyMessages.scrollHeight;
}

async function sendAiBuddyMessage(): Promise<void> {
  const text = el.aiBuddyInput.value.trim();
  if (!text || aiBuddySending) return;
  if (!(await window.bromeo.getOpenAiKeyStatus())) {
    toast(BromeoI18n.t("msg.aiBuddyKeyMissing"));
    return;
  }
  const imageBase64 = aiBuddyPendingScreenshot ?? undefined;
  aiBuddyLog.push({ role: "user", text, imageBase64, timestamp: Date.now() });
  el.aiBuddyInput.value = "";
  clearAiBuddyScreenshot();
  renderAiBuddyMessages();

  aiBuddySending = true;
  el.aiBuddySendBtn.disabled = true;
  el.aiBuddyStatus.textContent = BromeoI18n.t("msg.aiBuddyThinking");
  try {
    const history = aiBuddyLog.map((m) => ({ role: m.role, text: m.text, imageBase64: m.imageBase64 }));
    const result = await window.bromeo.askAiBuddy(history);
    aiBuddyLog.push({
      role: "assistant",
      text: result.ok && result.reply ? result.reply : `⚠️ ${result.error ?? BromeoI18n.t("msg.aiBuddyUnknownError")}`,
      timestamp: Date.now(),
    });
  } catch (err) {
    aiBuddyLog.push({ role: "assistant", text: `⚠️ ${(err as Error).message}`, timestamp: Date.now() });
  } finally {
    aiBuddySending = false;
    el.aiBuddySendBtn.disabled = false;
    el.aiBuddyStatus.textContent = "";
    renderAiBuddyMessages();
  }
}

// --- Multi-monitor switching (viewer side) ---

function populateMonitorSelect(monitors: MonitorInfo[]): void {
  el.monitorSelect.innerHTML = monitors.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
  el.monitorSelect.classList.toggle("hidden", monitors.length <= 1);
}

// --- File transfer UI rows ---

function addFileRow(id: string, name: string): void {
  const row = document.createElement("div");
  row.className = "file-row";
  row.id = `file-${id}`;
  row.innerHTML = `<div>${name}</div><progress value="0" max="100"></progress>`;
  el.filesList.prepend(row);
  el.filesPanel.classList.remove("hidden");
}

function updateFileRow(id: string, received: number, total: number): void {
  const row = document.getElementById(`file-${id}`);
  const bar = row?.querySelector("progress");
  if (bar) bar.value = total > 0 ? Math.round((received / total) * 100) : 0;
}

function finishFileRow(id: string, statusText: string): void {
  const row = document.getElementById(`file-${id}`);
  if (row) row.innerHTML += `<div class="muted small">${statusText}</div>`;
}

// --- Remote control input capture (viewer role) ---

function wireRemoteControlCapture(): void {
  const wrap = el.videoWrap;

  wrap.addEventListener("mousemove", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mousemove", xPct, yPct });
  });
  wrap.addEventListener("mousedown", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    wrap.focus();
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mousedown", button: buttonName(e.button), xPct, yPct });
  });
  wrap.addEventListener("mouseup", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mouseup", button: buttonName(e.button), xPct, yPct });
  });
  wrap.addEventListener("wheel", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "wheel", deltaX: e.deltaX, deltaY: e.deltaY });
  }, { passive: false });
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());

  wrap.addEventListener("keydown", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "keydown", key: e.key, code: e.code });
  });
  wrap.addEventListener("keyup", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "keyup", key: e.key, code: e.code });
  });

  function toPct(e: MouseEvent): { xPct: number; yPct: number } {
    const rect = el.remoteVideo.getBoundingClientRect();
    const xPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const yPct = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { xPct, yPct };
  }

  function buttonName(button: number): "left" | "right" | "middle" {
    if (button === 2) return "right";
    if (button === 1) return "middle";
    return "left";
  }
}

// --- Annotation/whiteboard overlay (viewer role) ---
// A transparent canvas layered over the remote video. While draw mode is
// active the canvas gets pointer-events, so mouse drags land on it instead
// of bubbling down to wireRemoteControlCapture's listeners on .video-wrap
// beneath — no changes needed there. Shapes are persistent: they stay until
// an explicit erase (single shape) or clear (everything) message arrives,
// not on a timer — rendering is purely event-driven, no redraw loop.

function resizeAnnotationCanvas(): void {
  const rect = el.remoteVideo.getBoundingClientRect();
  const wrapRect = el.videoWrap.getBoundingClientRect();
  const canvas = el.annotationCanvas;
  canvas.style.left = `${rect.left - wrapRect.left}px`;
  canvas.style.top = `${rect.top - wrapRect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  canvas.width = Math.max(1, Math.round(rect.width));
  canvas.height = Math.max(1, Math.round(rect.height));
}

// Renders any shape kind the host's richer whiteboard toolbox can send
// (pen/highlighter/rect/ellipse/text/comment) — this viewer-side canvas only
// ever *originates* "pen" shapes itself (see wireAnnotationCapture below),
// but has to be able to display whatever the host draws.
function drawAnnotationShape(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, shape: AnnotationShape): void {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  const px = (v: number) => v * canvas.width;
  const py = (v: number) => v * canvas.height;
  if (shape.kind === "pen" || shape.kind === "highlighter") {
    const points = shape.points ?? [];
    if (points.length < 2) return;
    ctx.lineWidth = shape.kind === "highlighter" ? 14 : 3;
    ctx.globalAlpha = shape.kind === "highlighter" ? 0.35 : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(px(p.x), py(p.y));
      else ctx.lineTo(px(p.x), py(p.y));
    });
    ctx.stroke();
  } else if (shape.kind === "rect") {
    ctx.lineWidth = 3;
    ctx.strokeRect(px(shape.x ?? 0), py(shape.y ?? 0), px(shape.w ?? 0), py(shape.h ?? 0));
  } else if (shape.kind === "ellipse") {
    ctx.lineWidth = 3;
    const cx = px((shape.x ?? 0) + (shape.w ?? 0) / 2);
    const cy = py((shape.y ?? 0) + (shape.h ?? 0) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(px(shape.w ?? 0) / 2), Math.abs(py(shape.h ?? 0) / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === "text") {
    ctx.font = "600 16px 'Segoe UI', Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(shape.text ?? "", px(shape.x ?? 0), py(shape.y ?? 0));
  } else if (shape.kind === "comment") {
    const x = px(shape.x ?? 0);
    const y = py(shape.y ?? 0);
    const text = shape.text ?? "";
    ctx.font = "600 13px 'Segoe UI', Arial, sans-serif";
    const padding = 8;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = 28;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    const r = 6;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r);
    ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r);
    ctx.arcTo(x, y + boxHeight, x, y, r);
    ctx.arcTo(x, y, x + boxWidth, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padding, y + boxHeight / 2 + 1);
  }
}

function redrawAnnotations(): void {
  const canvas = el.annotationCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const shape of annotationShapes) {
    drawAnnotationShape(ctx, canvas, shape);
  }
  // The in-progress local stroke, drawn live even before it's finalized/sent.
  if (currentStrokePoints.length >= 2) {
    drawAnnotationShape(ctx, canvas, { id: "", kind: "pen", color: ANNOTATION_COLOR, points: currentStrokePoints });
  }
  ctx.globalAlpha = 1;
}

function toggleAnnotateMode(): void {
  annotateModeActive = !annotateModeActive;
  el.annotateToggleBtn.classList.toggle("btn-primary", annotateModeActive);
  el.annotateToggleBtn.classList.toggle("btn-outline", !annotateModeActive);
  el.annotateToolbar.classList.toggle("hidden", !annotateModeActive);
  el.annotationCanvas.classList.toggle("drawing", annotateModeActive);
  if (annotateModeActive) {
    el.annotationCanvas.classList.remove("hidden");
    resizeAnnotationCanvas();
    redrawAnnotations();
  } else if (annotationShapes.length === 0) {
    el.annotationCanvas.classList.add("hidden");
  }
}

function receiveAnnotationShape(shape: AnnotationShape): void {
  annotationShapes.push(shape);
  el.annotationCanvas.classList.remove("hidden");
  resizeAnnotationCanvas();
  redrawAnnotations();
}

function eraseAnnotationShapeLocally(id: string): void {
  annotationShapes = annotationShapes.filter((s) => s.id !== id);
  redrawAnnotations();
}

function clearAnnotationsLocally(): void {
  annotationShapes = [];
  currentStrokePoints = [];
  currentStrokeId = null;
  redrawAnnotations();
  if (!annotateModeActive) el.annotationCanvas.classList.add("hidden");
}

function resetAnnotationState(): void {
  annotateModeActive = false;
  clearAnnotationsLocally();
  el.annotateToggleBtn.classList.remove("btn-primary");
  el.annotateToggleBtn.classList.add("btn-outline");
  el.annotateToolbar.classList.add("hidden");
  el.annotationCanvas.classList.add("hidden");
}

function wireAnnotationCapture(): void {
  const canvas = el.annotationCanvas;

  function toNorm(e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  canvas.addEventListener("mousedown", (e) => {
    if (!annotateModeActive || !currentSession) return;
    currentStrokeId = crypto.randomUUID();
    currentStrokePoints = [toNorm(e)];
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!annotateModeActive || !currentStrokeId) return;
    currentStrokePoints.push(toNorm(e));
    redrawAnnotations();
  });
  // Bound to window, not just the canvas, so a drag that ends after the
  // cursor leaves the canvas bounds still finalizes the stroke.
  window.addEventListener("mouseup", () => {
    if (!currentStrokeId || currentStrokePoints.length < 2) {
      currentStrokeId = null;
      currentStrokePoints = [];
      return;
    }
    const id = currentStrokeId;
    const points = currentStrokePoints;
    const shape: AnnotationShape = { id, kind: "pen", color: ANNOTATION_COLOR, points };
    annotationShapes.push(shape);
    currentSession?.sendSystemCommand({ kind: "annotation-shape", shape });
    currentStrokeId = null;
    currentStrokePoints = [];
    redrawAnnotations();
  });

  el.annotateToggleBtn.onclick = () => toggleAnnotateMode();
  el.annotateClearBtn.onclick = () => {
    clearAnnotationsLocally();
    currentSession?.sendSystemCommand({ kind: "annotation-clear" });
  };

  window.addEventListener("resize", () => {
    if (annotateModeActive || annotationShapes.length > 0) resizeAnnotationCanvas();
  });
}

// --- Voice intercom (viewer role) — talk to the person at the host
// machine, separate from the host's one-way system audio. See
// voiceTransceiver in session.ts for why this never needs renegotiation. ---
let micStream: MediaStream | null = null;

async function toggleMicrophone(): Promise<void> {
  if (!currentSession) return;
  if (micStream) {
    await currentSession.setMicrophoneTrack(null);
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    el.voiceToggleBtn.classList.remove("btn-primary");
    el.voiceToggleBtn.classList.add("btn-outline");
    toast(BromeoI18n.t("msg.micOff"));
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await currentSession.setMicrophoneTrack(micStream.getAudioTracks()[0]);
    el.voiceToggleBtn.classList.remove("btn-outline");
    el.voiceToggleBtn.classList.add("btn-primary");
    toast(BromeoI18n.t("msg.micOnViewer"));
  } catch (err) {
    toast(BromeoI18n.t("msg.micError", { error: (err as Error).message }));
  }
}

function resetMicrophoneState(): void {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  el.voiceToggleBtn.classList.remove("btn-primary");
  el.voiceToggleBtn.classList.add("btn-outline");
  el.voiceAudio.srcObject = null;
}

function updateFooterLicenseInfo(status: { valid: boolean; plan?: string; isTrial?: boolean } | null | undefined): void {
  const footerText = document.getElementById("footer-license-info");
  if (!footerText) return;
  if (status?.valid) {
    footerText.textContent = BromeoI18n.t("license.footerPlan", { plan: status.plan || "Free", trial: status.isTrial ? BromeoI18n.t("license.trialSuffix") : "" });
  } else {
    footerText.textContent = BromeoI18n.t("license.freeFooter");
  }
}

function updateExpiryText(expiresAt: string | null | undefined): void {
  const expiryText = document.getElementById("license-expiry-text");
  if (!expiryText) return;
  if (!expiresAt) {
    expiryText.textContent = "";
    return;
  }
  const date = new Date(expiresAt);
  const dateLabel = date.toLocaleDateString(BromeoI18n.getLang() === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const daysLeft = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    expiryText.textContent = BromeoI18n.t("license.expiredOn", { date: dateLabel });
  } else if (daysLeft === 0) {
    expiryText.textContent = BromeoI18n.t("license.expiresToday", { date: dateLabel });
  } else {
    expiryText.textContent = BromeoI18n.t("license.expiresIn", { date: dateLabel, days: daysLeft });
  }
}

function checkAndShowFreeUpsell(licenseStatus: any): void {
  const modal = document.getElementById("free-upsell-modal");
  const dismissBtn = document.getElementById("free-upsell-dismiss");
  const buyBtn = document.getElementById("free-upsell-buy");
  if (!modal || !dismissBtn || !buyBtn) return;

  const isPaid = licenseStatus && licenseStatus.valid && licenseStatus.plan &&
    (licenseStatus.plan === "Pro" || licenseStatus.plan === "Professional" || licenseStatus.plan === "Unlimited" || licenseStatus.plan === "Enterprise");

  if (!isPaid) {
    // Show pop-up on startup for Free users
    modal.classList.remove("hidden");

    dismissBtn.onclick = () => {
      modal.classList.add("hidden");
    };

    buyBtn.onclick = () => {
      modal.classList.add("hidden");
      void window.bromeo?.openExternal?.("https://bromeoremote.com/?account=1");
    };
  }
}

async function initLicenseSection(): Promise<void> {
  const emailInput = document.getElementById("license-email-input") as HTMLInputElement | null;
  const keyInput = document.getElementById("license-key-input") as HTMLInputElement | null;
  const verifyBtn = document.getElementById("license-verify-btn") as HTMLButtonElement | null;
  const upgradeBtn = document.getElementById("license-upgrade-btn") as HTMLButtonElement | null;
  const statusText = document.getElementById("license-status-text") as HTMLElement | null;

  if (!emailInput || !keyInput || !verifyBtn || !statusText) return;

  upgradeBtn?.addEventListener("click", () => {
    void window.bromeo?.openExternal?.("https://bromeoremote.com/?account=1");
  });

  let cachedEmail = "";
  let cachedKey = "";
  let cachedHwid = "";

  if (window.bromeo?.getLicenseStatus) {
    try {
      const info = await window.bromeo.getLicenseStatus();
      cachedEmail = info.licenseEmail || "";
      cachedKey = info.licenseKey || "";
      cachedHwid = info.hwid || "";
      if (cachedEmail) emailInput.value = cachedEmail;
      if (cachedKey) keyInput.value = cachedKey;

      if (info.licenseStatus) {
        if (info.licenseStatus.valid) {
          statusText.style.color = "#0be881";
          statusText.textContent = BromeoI18n.t("license.statusActive", { plan: info.licenseStatus.plan || "Free", hwid: info.hwid.slice(0, 12) });
        } else {
          statusText.style.color = "#ff4d6d";
          statusText.textContent = BromeoI18n.t("license.statusInvalid", { reason: info.licenseStatus.reason || BromeoI18n.t("license.invalidReason") });
        }
        updateFooterLicenseInfo(info.licenseStatus);
        updateExpiryText(info.licenseStatus.expiresAt);
        checkAndShowFreeUpsell(info.licenseStatus);
      } else {
        statusText.textContent = BromeoI18n.t("license.statusNotChecked");
        updateFooterLicenseInfo(null);
        checkAndShowFreeUpsell(null);
      }
    } catch {
      statusText.textContent = BromeoI18n.t("license.statusDefaultFree");
      updateFooterLicenseInfo(null);
      checkAndShowFreeUpsell(null);
    }
  }

  // Silently re-check with the server on startup so admin-side license changes
  // (e.g. a trial added after the last manual check) show up without the user
  // having to re-open this tab and click Verify themselves.
  if ((cachedEmail || cachedKey) && window.bromeo?.verifyLicense) {
    void window.bromeo
      .verifyLicense(cachedKey, cachedEmail)
      .then((res) => {
        if (res.valid) {
          statusText.style.color = "#0be881";
          statusText.textContent = BromeoI18n.t("license.statusActive", { plan: res.plan || "Free", hwid: cachedHwid.slice(0, 12) });
          updateExpiryText(res.expiresAt);
        }
        updateFooterLicenseInfo(res);
      })
      .catch(() => {});
  }

  verifyBtn.onclick = async () => {
    const email = emailInput.value.trim();
    const key = keyInput.value.trim();
    if (!email && !key) {
      toast(BromeoI18n.t("license.emailOrKeyRequired"));
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = BromeoI18n.t("license.checkingBtn");
    statusText.style.color = "#8898aa";
    statusText.textContent = BromeoI18n.t("license.statusCheckingServer");

    try {
      const res = await window.bromeo.verifyLicense(key, email);
      if (res.valid) {
        statusText.style.color = "#0be881";
        statusText.textContent = BromeoI18n.t("license.activatedStatus", { plan: res.plan || "Pro" });
        toast(BromeoI18n.t("license.activatedToast", { email: res.userEmail || email }));
        updateExpiryText(res.expiresAt);
      } else {
        statusText.style.color = "#ff4d6d";
        statusText.textContent = BromeoI18n.t("license.failedStatus", { reason: res.reason || BromeoI18n.t("license.checkFailedGeneric") });
        toast(BromeoI18n.t("license.failedToast", { reason: res.reason || BromeoI18n.t("license.unknownError") }));
        updateExpiryText(null);
      }
      updateFooterLicenseInfo(res);
    } catch (err: any) {
      statusText.style.color = "#ff4d6d";
      statusText.textContent = BromeoI18n.t("license.connectError", { message: err.message || err });
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = BromeoI18n.t("license.verifyBtn");
    }
  };
}

function wireVoiceIntercom(): void {
  el.voiceToggleBtn.onclick = () => void toggleMicrophone();
  void initLicenseSection();
}

init().catch((err) => console.error("init failed", err));
