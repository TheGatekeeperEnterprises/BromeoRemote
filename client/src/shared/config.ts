// Default network config. Override via environment variables at build/run time,
// or later via an in-app settings screen (see docs/ROADMAP.md).

// `process` only exists in the main process (Node); the renderer runs with
// contextIsolation and no Node integration, so guard the lookup.
const envSignalingUrl =
  typeof process !== "undefined" && process.env ? process.env.BROMEO_SIGNALING_URL : undefined;

export const DEFAULT_SIGNALING_URL = envSignalingUrl ?? "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  // Offer both TURN transports. TURN/TCP is useful behind restrictive NATs,
  // but the app must not depend on it exclusively: if TCP 3478 is blocked,
  // direct/STUN or TURN/UDP should still let the session start.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
