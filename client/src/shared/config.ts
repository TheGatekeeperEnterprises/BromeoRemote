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

  // Primary BromeoRemote TURN Server — hostname only. A literal-IP fallback
  // used to sit here too, but it bypasses the OPNsense split-DNS host
  // override (turn.bromeoremote.com -> the coturn box's LAN address for
  // home-network clients, see docs/WEBRTC-TURN-DEBUGGING.md §2.4) since
  // there's no hostname for a DNS override to catch. Any client on that
  // same home LAN using the literal IP instead hits the router's public IP
  // directly and hairpins through OPNsense's NAT reflection, which comes
  // back with garbage addressing (confirmed live: srflx candidates
  // reporting the router's own LAN IP as the "reflexive" address, and TURN
  // relay candidates never surfacing despite the server-side ALLOCATE
  // succeeding). Removed rather than fixed at the router level since the
  // hostname entry already covers both on-LAN (via the override) and
  // off-LAN (normal public DNS) correctly on its own.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
