// Shared message contract between BromeoRemote clients and the signaling server.
// Kept intentionally "dumb": the server only ever sees IDs, password *hashes*,
// and opaque WebRTC signaling payloads. It never sees screen data, keystrokes,
// files, or plaintext passwords.

export interface NotificationPayload {
  id: string;
  source: string;
  title: string;
  message: string;
  kind: "info" | "confirm";
  createdAt: number;
}

export interface SessionPermissions {
  control: boolean;
  clipboard: boolean;
  files: boolean;
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
  | { type: "notify-response"; targetId: string; notificationId: string; decision: "allow" | "deny" }
  | { type: "register-push-token"; token: string };

export type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "error"; message: string }
  | { type: "incoming-request"; fromId: string; fromLabel?: string; passwordHash: string; viewOnly?: boolean; permissions?: SessionPermissions; totpCode?: string }
  | { type: "connect-response"; fromId: string; accept: boolean; reason?: string }
  | { type: "signal"; fromId: string; payload: unknown }
  | { type: "peer-disconnected"; peerId: string }
  | { type: "notify"; fromId: string; notification: NotificationPayload }
  | { type: "notify-response"; notificationId: string; decision: "allow" | "deny" };
