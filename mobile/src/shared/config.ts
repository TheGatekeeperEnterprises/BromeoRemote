// On the Android emulator, 10.0.2.2 is the special alias for "the host
// machine's localhost"; plain "localhost" refers to the emulator itself.
// For LAN-only testing instead of production, swap this back to
// "ws://10.0.2.2:21116" (emulator) or "ws://<pc-lan-ip>:21116" (real phone).
export const DEFAULT_SIGNALING_URL = "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Offer both TURN transports. The app should prefer any healthy direct
  // path, but still has TURN fallback when NAT traversal needs it.
  { urls: "turn:turn.bromeoremote.com:3478", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
  { urls: "turn:turn.bromeoremote.com:3478?transport=tcp", username: "bromeo", credential: "pvyht0ejbJigBjAzTI6IVFJ0GGYVH29h" },
];
