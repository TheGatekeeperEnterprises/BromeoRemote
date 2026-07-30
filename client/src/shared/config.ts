// Default network config. Override via environment variables at build/run time,
// or later via an in-app settings screen (see docs/ROADMAP.md).

const envSignalingUrl =
  typeof process !== "undefined" && process.env ? process.env.BROMEO_SIGNALING_URL : undefined;

export const DEFAULT_SIGNALING_URL = envSignalingUrl ?? "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Google & Twilio Public STUN Cluster
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },

  // Primary BromeoRemote TURN Server — hosted on a dedicated VPS, independent
  // of any client's own network (see docs/WEBRTC-TURN-DEBUGGING.md). Earlier
  // this was self-hosted on a home LAN, which caused relay candidates to
  // silently fail for any client on that same LAN — moving it fixed that
  // for good, so no LAN-specific fallback entries are needed here anymore.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  // Same server, literal IP — a fallback in case turn.bromeoremote.com's DNS
  // is ever unreachable/flaky on a given network (this and the public
  // fallback below were dropped by an unrelated commit; restoring both as
  // cheap insurance, not because the hostname is known to be failing).
  { urls: "turn:62.45.93.36:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:62.45.93.36:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  // Third-party public TURN fallback, only ever reached if both of the above fail.
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];
