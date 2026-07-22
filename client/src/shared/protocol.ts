// Mirrors server/src/types.ts — kept manually in sync since client and server
// are separate npm packages. Do not send/receive anything outside this shape.

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

export type SystemCommand =
  | { kind: "restart-request" }
  | { kind: "lock-request" }
  | { kind: "lock-on-session-end"; enabled: boolean }
  | { kind: "lock-on-session-end-status"; enabled: boolean; ok: boolean }
  | { kind: "quality-request"; level: QualityLevel }
  | { kind: "block-input"; enabled: boolean }
  | { kind: "block-input-status"; enabled: boolean; ok: boolean }
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
  | { kind: "switch-to-desktop" };

export type FileMessage =
  | { kind: "file-offer"; id: string; name: string; size: number }
  | { kind: "file-accept"; id: string }
  | { kind: "file-decline"; id: string }
  | { kind: "file-chunk"; id: string; index: number; total: number; data: string } // base64
  | { kind: "file-done"; id: string };
