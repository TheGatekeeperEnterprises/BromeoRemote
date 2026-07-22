// Default network config. Override via environment variables at build/run time,
// or later via an in-app settings screen (see docs/ROADMAP.md).

// `process` only exists in the main process (Node) — the renderer runs with
// contextIsolation and no Node integration, so guard the lookup.
const envSignalingUrl =
  typeof process !== "undefined" && process.env ? process.env.BROMEO_SIGNALING_URL : undefined;

export const DEFAULT_SIGNALING_URL = envSignalingUrl ?? "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  // Self-hosted coturn (see coturn/ + docs/DEPLOY.md §2). Only used as a
  // fallback when a direct P2P path isn't possible (strict NAT/firewalls) —
  // static long-term credentials are fine here since this is a single-tenant
  // relay, not a public multi-user TURN service.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
