// Default network config. Override via environment variables at build/run time,
// or later via an in-app settings screen (see docs/ROADMAP.md).

// `process` only exists in the main process (Node) — the renderer runs with
// contextIsolation and no Node integration, so guard the lookup.
const envSignalingUrl =
  typeof process !== "undefined" && process.env ? process.env.BROMEO_SIGNALING_URL : undefined;

export const DEFAULT_SIGNALING_URL = envSignalingUrl ?? "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  // Replace with your own coturn deployment for production use, e.g.:
  // { urls: "turn:your-vps-ip:3478", username: "bromeo", credential: "changeme" },
];
