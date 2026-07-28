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

  // Primary BromeoRemote TURN Server — hostname (works everywhere: public DNS
  // off the home LAN, OPNsense split-DNS override on it — see
  // docs/WEBRTC-TURN-DEBUGGING.md §2.4). A literal PUBLIC-IP fallback used to
  // sit here too; removed because it bypasses that override and hairpins
  // through OPNsense's NAT reflection for LAN clients (confirmed: garbage
  // srflx addressing, relay candidates never surfacing despite the
  // server-side ALLOCATE succeeding).
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },

  // LAN-private-IP fallback, deliberately separate from the removed public-IP
  // one above. chrome://webrtc-internals on this home LAN showed the
  // hostname lookup itself intermittently failing inside Chromium's own
  // resolver ("STUN/TURN host lookup received error", code 701) even though
  // the OS resolver (nslookup/Resolve-DnsName) resolves it fine — a flaky
  // interaction between Chromium's DNS client and the OPNsense/Unbound
  // split-DNS path under load, not a hairpin issue. This needs no DNS lookup
  // at all, so it's immune to that flakiness. Off-LAN, this address is just
  // unreachable and the candidate silently fails — harmless, and nothing
  // else relies on it succeeding there.
  { urls: "turn:192.168.1.20:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:192.168.1.20:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
