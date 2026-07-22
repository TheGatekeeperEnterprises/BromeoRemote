// On the Android emulator, 10.0.2.2 is the special alias for "the host
// machine's localhost" — plain "localhost" refers to the emulator itself.
// For LAN-only testing instead of production, swap this back to
// "ws://10.0.2.2:21116" (emulator) or "ws://<pc-lan-ip>:21116" (real phone).
export const DEFAULT_SIGNALING_URL = "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Self-hosted coturn (see coturn/ + docs/DEPLOY.md §2). Only used as a
  // fallback when a direct P2P path isn't possible (strict NAT/firewalls) —
  // static long-term credentials are fine here since this is a single-tenant
  // relay, not a public multi-user TURN service.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
