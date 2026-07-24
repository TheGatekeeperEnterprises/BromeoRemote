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
    }
  | { type: "connect-response"; targetId: string; accept: boolean; reason?: string }
  | { type: "signal"; targetId: string; payload: unknown }
  | { type: "bye"; targetId: string }
  | { type: "notify"; targetId: string; fromId: string; notification: NotificationPayload }
  | { type: "notify-response"; targetId: string; notificationId: string; decision: "allow" | "deny" };

export type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "error"; message: string }
  | { type: "incoming-request"; fromId: string; fromLabel?: string; passwordHash: string; viewOnly?: boolean; permissions?: SessionPermissions; totpCode?: string }
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
  | { kind: "adaptive-status"; resolutionScaled: boolean };

export type FileMessage =
  | { kind: "file-offer"; id: string; name: string; size: number }
  | { kind: "file-accept"; id: string }
  | { kind: "file-decline"; id: string }
  | { kind: "file-chunk"; id: string; index: number; total: number; data: string } // base64
  | { kind: "file-done"; id: string };
