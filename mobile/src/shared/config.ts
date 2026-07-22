// On the Android emulator, 10.0.2.2 is the special alias for "the host
// machine's localhost" — plain "localhost" refers to the emulator itself.
// On a real phone (same wifi as your signaling server), point at that
// machine's LAN IP instead (only one can be active at a time here), or at
// your production wss:// domain (see docs/DEPLOY.md in the repo root).
// export const DEFAULT_SIGNALING_URL = "ws://10.0.2.2:21116"; // emulator
export const DEFAULT_SIGNALING_URL = "ws://192.168.1.128:21116"; // real phone, same wifi as this PC

export const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Replace with your own coturn deployment for production use, e.g.:
  // { urls: "turn:your-vps-ip:3478", username: "bromeo", credential: "changeme" },
];
