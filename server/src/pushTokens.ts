// In-memory map of BromeoRemote-ID -> FCM push token, kept separate from
// DeviceRegistry: a token must survive across reconnects/offline periods
// (that's the whole point of push), unlike the registry's live-socket map.
// Lost on server restart, like the rest of this stateless server.
const tokens = new Map<string, string>();

export function setPushToken(deviceId: string, token: string): void {
  tokens.set(deviceId, token);
}

export function getPushToken(deviceId: string): string | undefined {
  return tokens.get(deviceId);
}
