// Default network config. Override via environment variables at build/run time,
// or later via an in-app settings screen (see docs/ROADMAP.md).

// `process` only exists in the main process (Node) — the renderer runs with
// contextIsolation and no Node integration, so guard the lookup.
const envSignalingUrl =
  typeof process !== "undefined" && process.env ? process.env.BROMEO_SIGNALING_URL : undefined;

export const DEFAULT_SIGNALING_URL = envSignalingUrl ?? "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  // Self-hosted coturn (see coturn/ + docs/DEPLOY.md §2). With relay-only ICE
  // (see session.ts) this is the *only* path, so both transports matter: UDP
  // is normally preferred, but mobile carrier CGNAT frequently reassigns NAT
  // mappings mid-flow for long-lived UDP, breaking allocation before it ever
  // pairs. TCP is far more NAT-friendly for that case, so both are offered
  // and ICE picks whichever pairs successfully. Static long-term credentials
  // are fine here since this is a single-tenant relay, not a public service.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
