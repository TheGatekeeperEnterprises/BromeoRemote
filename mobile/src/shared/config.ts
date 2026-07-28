export const DEFAULT_SIGNALING_URL = "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS = [
  // Google & Twilio Public STUN Cluster
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },

  // Primary BromeoRemote TURN Server — hostname, plus a LAN-private-IP
  // fallback that needs no DNS lookup. See client/src/shared/config.ts's
  // matching comment: a literal PUBLIC-IP fallback used to sit here too, but
  // it bypasses the OPNsense split-DNS override and hairpins for LAN
  // clients. The private-IP entry below is different and safe — it's simply
  // unreachable (and harmlessly ignored) off that one home LAN.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:192.168.1.20:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:192.168.1.20:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
