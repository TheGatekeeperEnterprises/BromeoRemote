// Mirrors server/src/types.ts — kept manually in sync since client and server
// are separate npm packages. Do not send/receive anything outside this shape.

// AI Buddy — local-only (never touches the signaling server), a device asks
// its own configured OpenAI account for help while looking at a remote
// session. Shared here since main.ts (calls OpenAI), preload.ts, and
// global.d.ts (renderer types) all need the same shape.
export interface AiBuddyMessage {
  role: "user" | "assistant";
  text: string;
  imageBase64?: string; // data URL, e.g. "data:image/jpeg;base64,..."
}

export interface AiBuddyResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

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
  // Optional structure for agent-style confirm requests (e.g. a hook
  // reporting exactly which shell command it wants to run).
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
      // "Remember this device" for 2FA — see StoreData.trustedDevices and
      // checkPassword's handling in main.ts. Only meaningful alongside a
      // totpCode; the host decides whether to actually honor it (only after
      // that code verifies).
      trustDevice?: boolean;
    }
  | { type: "connect-response"; targetId: string; accept: boolean; reason?: string }
  | { type: "signal"; targetId: string; payload: unknown }
  | { type: "bye"; targetId: string }
  | { type: "notify"; targetId: string; fromId: string; notification: NotificationPayload }
  | { type: "notify-response"; targetId: string; notificationId: string; decision: "allow" | "deny" };

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
  | { kind: "lock-on-session-end"; enabled: boolean }
  | { kind: "lock-on-session-end-status"; enabled: boolean; ok: boolean }
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
| { kind: "switch-dual-window"; windowId1: string; windowId2: string; aspect: number; isPortrait: boolean }
  | { kind: "resize-dual-window"; aspect: number; isPortrait: boolean }
  // View two whole monitors simultaneously, composited side-by-side
  // (landscape) or stacked (portrait) into one video feed — unlike
  // switch-dual-window, there's no window to reposition/crop; each monitor
  // is already its own independent capturable source, so the host just
  // captures both and draws them into halves of one canvas (see
  // createDualMonitorStream in renderer/app.ts). aspect/isPortrait follow
  // the same convention as the dual-window commands.
  | { kind: "switch-dual-monitor"; monitorId1: string; monitorId2: string; aspect: number; isPortrait: boolean }
  | { kind: "resize-dual-monitor"; aspect: number; isPortrait: boolean }
  // Immediately tells the viewer the new video stream dimensions
  | { kind: "video-dimensions"; width: number; height: number }
  // Sent host->viewer whenever the host's actual OS cursor shape changes
  // (only while a session is connected — see the poll loop in app.ts),
  // so the viewer's own on-screen cursor overlay can match it, the way a
  // real remote-desktop client does (link hover = hand, text field = I-beam,
  // etc.) instead of always showing a plain arrow.
  | { kind: "cursor-shape"; shape: CursorShapeName }
  // Sent viewer->host whenever the viewer's pinch-zoom crosses the "zoomed
  // in" threshold — lets the host's adaptive bitrate engine (see
  // updateAdaptiveBitrate in renderer/session.ts) bias toward sharpness
  // while the user is actively scrutinizing detail, independent of
  // whichever quality tier is selected.
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
  // (join/leave) during multi-viewer hosting, so anyone watching can see who
  // else is watching too — a transparency guarantee for a remote-support
  // tool, not just a UI nicety. See docs/features.md's scoring and
  // hostViewers in renderer/app.ts.
  | { kind: "viewer-list"; viewers: { label: string; viewOnly: boolean }[] }
  // Sent host->viewer whenever that specific viewer's own permissions change
  // mid-session (currently: promoting/demoting who has control — see
  // promoteViewerToControl in renderer/app.ts). Lets the viewer re-apply its
  // own UI (toolbar buttons, view-only badge, input capture) live instead of
  // requiring a reconnect for a permission change to take visible effect.
  | { kind: "permissions-update"; permissions: SessionPermissions }
  // Lightweight annotation/whiteboard overlay drawn on top of the shared
  // video, e.g. circling a button to explain what to click — not
  // persistent markup, just temporary on-screen pointing. Points are
  // normalized [0,1] coordinates relative to the video frame (same
  // convention as InputEvent's xPct/yPct) so they translate correctly
  // regardless of each client's own video render size. Sent whole-stroke
  // (not per-point) once a drag gesture completes, viewer->host->other
  // viewers (the host just relays, it doesn't render — see
  // broadcastSystemCommand's excludePeerId in renderer/app.ts). Any
  // connected viewer can draw, controlling or not — purely a
  // communication aid, no security implication.
  | { kind: "annotation-stroke"; id: string; points: { x: number; y: number }[]; color: string }
  | { kind: "annotation-clear" };

export type FileMessage =
  | { kind: "file-offer"; id: string; name: string; size: number }
  | { kind: "file-accept"; id: string }
  | { kind: "file-decline"; id: string }
  | { kind: "file-chunk"; id: string; index: number; total: number; data: string } // base64
  | { kind: "file-done"; id: string };
