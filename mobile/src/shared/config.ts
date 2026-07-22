// On the Android emulator, 10.0.2.2 is the special alias for "the host
// machine's localhost" — plain "localhost" refers to the emulator itself.
// For LAN-only testing instead of production, swap this back to
// "ws://10.0.2.2:21116" (emulator) or "ws://<pc-lan-ip>:21116" (real phone).
export const DEFAULT_SIGNALING_URL = "wss://remote.bromeoremote.com";

export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Replace with your own coturn deployment for production use, e.g.:
  // { urls: "turn:your-vps-ip:3478", username: "bromeo", credential: "changeme" },
];
