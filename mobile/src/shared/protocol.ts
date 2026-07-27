// Mirrors client/src/shared/protocol.ts (and server/src/types.ts) — kept
// manually in sync since each is a separate package. Do not send/receive
// anything outside this shape.

export interface SavedDevice {
  id: string;
  label: string;
  passwordHash: string;
  viewOnly: boolean;
  permissions?: SessionPermissions;
  mac?: string;
  group?: string;
  favorite?: boolean;
}

export interface SessionPermissions {
  control: boolean;
  clipboard: boolean;
  files: boolean;
}

export interface UpdateStatus {
  status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  error?: string;
}

export interface NotificationPayload {
  id: string;
  source: string;
  title: string;
  message: string;
  kind: "info" | "confirm";
  createdAt: number;
  command?: string;
  cwd?: string;
  riskLevel?: "low" | "medium" | "high";
}

export type ClientMessage =
  | { type: "hello"; id?: string }
  | {
      type: "connect-request";
      targetId: string;
      fromId: string;
      fromLabel?: string;
      passwordHash: string;
      viewOnly?: boolean;
      permissions?: SessionPermissions;
      totpCode?: string;
      trustDevice?: boolean;
    }
  | { type: "connect-response"; targetId: string; accept: boolean; reason?: string }
  | { type: "signal"; targetId: string; payload: unknown }
  | { type: "bye"; targetId: string }
  | { type: "notify"; targetId: string; fromId: string; notification: NotificationPayload }
  | { type: "notify-response"; targetId: string; notificationId: string; decision: "allow" | "deny" }
  | { type: "register-push-token"; token: string };

export type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "error"; message: string }
  | {
      type: "incoming-request";
      fromId: string;
      fromLabel?: string;
      passwordHash: string;
      viewOnly?: boolean;
      permissions?: SessionPermissions;
      totpCode?: string;
      trustDevice?: boolean;
    }
  | { type: "connect-response"; fromId: string; accept: boolean; reason?: string }
  | { type: "signal"; fromId: string; payload: unknown }
  | { type: "peer-disconnected"; peerId: string }
  | { type: "notify"; fromId: string; notification: NotificationPayload }
  | { type: "notify-response"; notificationId: string; decision: "allow" | "deny" };

// --- WebRTC DataChannel payloads (peer-to-peer, never touch the server) ---

export type InputEvent =
  | { kind: "mousemove"; xPct: number; yPct: number }
  | { kind: "mousedown" | "mouseup"; button: "left" | "right" | "middle"; xPct: number; yPct: number }
  | { kind: "wheel"; deltaX: number; deltaY: number }
  | { kind: "keydown" | "keyup"; key: string; code: string }
  | { kind: "text"; value: string };

export type ClipboardMessage = { kind: "clipboard"; text: string };

export type ChatMessage = { kind: "chat"; text: string; timestamp: number };

export interface MonitorInfo {
  id: string;
  label: string;
}

export interface WindowInfo {
  id: string;
  name: string;
  thumbnail?: string; // small base64 data URL, if available
}

export type QualityLevel = "auto" | "high" | "low";

// "sharp" = native capture resolution (current default) — the encoder has to
// push every source pixel, which is what lets pinch-zoom reach real detail,
// but on weaker/loaded hardware the encoder can't sustain the requested
// frame rate at that pixel count, so delivered fps (and therefore cursor
// responsiveness) drops well below what was asked for. "fast" caps the
// capture at 1080p so the encoder can actually keep up and hit close to the
// real frame rate, at the cost of that native-resolution zoom sharpness.
export type ResolutionMode = "sharp" | "fast";

// Which standard OS cursor is currently showing on the host, detected via
// GetCursorInfo/LoadCursor comparison (see getCursorShape in
// client/src/main/system.ts) — Windows itself doesn't expose "what shape is
// this" any more directly than "does this handle equal that handle", so a
// custom/app-drawn cursor that doesn't match any of these falls back to
// "arrow". Covers the shapes a remote-support session actually encounters
// (links/buttons, text fields, window edges); anything rarer just reads as
// "arrow" too, which is a reasonable default.
export type CursorShapeName =
  | "arrow"
  | "hand"
  | "text"
  | "resize-ns"
  | "resize-ew"
  | "resize-nesw"
  | "resize-nwse"
  | "move"
  | "wait"
  | "not-allowed"
  | "help";

export type SystemCommand =
  | { kind: "restart-request" }
  | { kind: "lock-request" }
  | { kind: "quality-request"; level: QualityLevel }
  | { kind: "resolution-preference"; mode: ResolutionMode }
  | { kind: "block-input"; enabled: boolean }
  | { kind: "block-input-status"; enabled: boolean; ok: boolean }
  // Hides just the desktop wallpaper image (blank background color instead)
  // while the session is active — distinct from curtain mode, which blanks
  // the whole local screen. Windows-only (see hideWallpaper in
  // client/src/main/system.ts).
  | { kind: "hide-wallpaper"; enabled: boolean }
  | { kind: "hide-wallpaper-status"; enabled: boolean; ok: boolean }
  | { kind: "ctrl-alt-del-request" }
  | { kind: "ctrl-alt-del-status"; ok: boolean; installed: boolean }
  | { kind: "monitor-list"; monitors: MonitorInfo[] }
  | { kind: "switch-monitor"; monitorId: string }
  | { kind: "window-list-request" }
  | { kind: "window-list"; windows: WindowInfo[] }
  // aspect = viewer's screen width/height at the moment of switching/rotating,
  // used to resize the host's window to fill that shape with minimal
  // letterboxing (see resizeAndFocusWindow in client/src/main/system.ts).
  | { kind: "switch-window"; windowId: string; aspect: number }
  | { kind: "resize-active-window"; aspect: number }
  | { kind: "switch-to-desktop" }
  // Immediately tells the viewer the new video stream dimensions — mirrors
  // client/src/shared/protocol.ts exactly. Was missing here (protocol.ts is
  // manually kept in sync between client/mobile, not shared/imported) while
  // App.tsx's consumer of it was left in place, which is a genuine compile
  // error, not a style choice — restoring it, not reverting anything
  // intentional.
  | { kind: "video-dimensions"; width: number; height: number }
  | { kind: "switch-dual-window"; windowId1: string; windowId2: string; aspect: number; isPortrait: boolean }
  | { kind: "resize-dual-window"; aspect: number; isPortrait: boolean }
  // View two whole monitors simultaneously, composited side-by-side or
  // stacked into one video feed — see client/src/shared/protocol.ts's copy
  // of this type for the full explanation.
  | { kind: "switch-dual-monitor"; monitorId1: string; monitorId2: string; aspect: number; isPortrait: boolean }
  | { kind: "resize-dual-monitor"; aspect: number; isPortrait: boolean }
  // Sent host->viewer whenever the host's actual OS cursor shape changes
  // (only while a session is connected — see the poll loop in app.ts),
  // so the viewer's own on-screen cursor overlay can match it, the way a
  // real remote-desktop client does (link hover = hand, text field = I-beam,
  // etc.) instead of always showing a plain arrow.
  | { kind: "cursor-shape"; shape: CursorShapeName }
  // Sent viewer->host whenever the viewer's pinch-zoom crosses the "zoomed
  // in" threshold — lets the host's adaptive bitrate engine (see
  // updateAdaptiveBitrate in client/src/renderer/session.ts) bias toward
  // sharpness while the user is actively scrutinizing detail, independent
  // of whichever quality tier is selected.
  | { kind: "zoom-state"; zoomedIn: boolean }
  // Sent host->viewer whenever the adaptive engine's last-resort resolution
  // scale-down (see ADAPTIVE_RESOLUTION_SCALE_DOWN) turns on or off, so the
  // viewer can show *why* things look softer instead of it looking like an
  // unexplained quality bug.
  | { kind: "adaptive-status"; resolutionScaled: boolean }
  // Sent host->viewer every stats tick with the encoder's own
  // qualityLimitationReason (from RTCOutboundRtpStreamStats — "cpu",
  // "bandwidth", "other", or "none"/null). Only meaningful on the host's own
  // outbound-rtp stats, which the viewer has no way to read directly (each
  // side's getStats() only sees its own local sender/receiver reports) —
  // this is diagnostic-only, surfaced in the viewer's stats line to show
  // *why* delivered fps is capped instead of leaving it unexplained.
  | { kind: "encoder-limitation"; reason: string | null }
  // Sent host->every viewer whenever the set of connected viewers changes
  // (join/leave) during multi-viewer hosting (desktop-only in phase 1 — see
  // docs/features.md and the multi-viewer plan doc). Mirrored here for
  // protocol consistency; mobile doesn't emit it yet, but a mobile viewer
  // connected to a desktop host may receive it.
  | { kind: "viewer-list"; viewers: { label: string; viewOnly: boolean }[] }
  // Sent host->viewer whenever that specific viewer's own permissions change
  // mid-session (currently: promoting/demoting who has control — see
  // promoteViewerToControl in the desktop host's renderer/app.ts). Lets the
  // viewer re-apply its own UI live instead of requiring a reconnect.
  | { kind: "permissions-update"; permissions: SessionPermissions }
  // Lightweight annotation/whiteboard overlay drawn on top of the shared
  // video — see client/src/shared/protocol.ts's copy of this type for the
  // full explanation. Points are normalized [0,1] coordinates relative to
  // the video frame.
  | { kind: "annotation-stroke"; id: string; points: { x: number; y: number }[]; color: string }
  | { kind: "annotation-clear" };

export type FileMessage =
  | { kind: "file-offer"; id: string; name: string; size: number }
  | { kind: "file-accept"; id: string }
  | { kind: "file-decline"; id: string }
  | { kind: "file-chunk"; id: string; index: number; total: number; data: string } // base64
  | { kind: "file-done"; id: string };
