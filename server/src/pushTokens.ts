// BromeoRemote-ID -> FCM push token, kept separate from DeviceRegistry: a
// token must survive across reconnects/offline periods (that's the whole
// point of push), unlike the registry's live-socket map.
//
// Persisted to a local JSON file so a plain process restart (crash, `npm
// run dev` reload, non-destructive redeploy) doesn't silently forget every
// registered phone until it next happens to reopen the app. This still
// won't survive a full container rebuild/redeploy on a platform like
// Coolify unless PUSH_TOKENS_PATH points at a persistent volume — without
// one, this is strictly better than pure in-memory (covers the more common
// case) but not a complete fix; mount a volume for that.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";

const TOKENS_PATH = process.env.PUSH_TOKENS_PATH ?? "./data/push-tokens.json";

function load(): Map<string, string> {
  try {
    if (!existsSync(TOKENS_PATH)) return new Map();
    const raw = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));
    return new Map(Object.entries(raw));
  } catch (err) {
    console.error(`Kon ${TOKENS_PATH} niet lezen, start met een lege push-tokenlijst:`, (err as Error).message);
    return new Map();
  }
}

const tokens = load();

function persist(): void {
  try {
    mkdirSync(dirname(TOKENS_PATH), { recursive: true });
    writeFileSync(TOKENS_PATH, JSON.stringify(Object.fromEntries(tokens)));
  } catch (err) {
    console.error(`Kon push-tokens niet wegschrijven naar ${TOKENS_PATH}:`, (err as Error).message);
  }
}

export function setPushToken(deviceId: string, token: string): void {
  tokens.set(deviceId, token);
  persist();
}

export function getPushToken(deviceId: string): string | undefined {
  return tokens.get(deviceId);
}
