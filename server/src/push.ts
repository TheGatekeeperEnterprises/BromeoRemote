import { readFileSync } from "fs";
import type { NotificationPayload } from "./types";

// Optional: only active once either FIREBASE_SERVICE_ACCOUNT_JSON or
// FIREBASE_SERVICE_ACCOUNT_PATH points at a real service account key from
// your own Firebase project (docs/MOBILE.md §5). Without either, push sends
// are silent no-ops — the existing WebSocket-based notify/confirm flow
// keeps working exactly as before, this is additive.
//
// _JSON exists specifically because _PATH requires a file to actually be
// present inside wherever this process runs — trivial when running
// directly on a machine, but on a container platform like Coolify that
// means mounting a persistent volume just to hold one secret file. _JSON
// (the key's raw contents, or that pasted straight into a base64 encoder)
// can just be pasted as a normal environment variable instead, no volume
// needed. Whichever is set is used; _JSON is checked first.
let messagingInstance: import("firebase-admin/messaging").Messaging | null = null;
let warnedMissingConfig = false;

function loadServiceAccount(): Record<string, unknown> | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    // Accept both the raw JSON pasted directly into the env var, and a
    // base64 encoding of it (some platforms mangle multiline/quote-heavy
    // env var values — base64 sidesteps that entirely).
    const looksLikeJson = json.trim().startsWith("{");
    const decoded = looksLikeJson ? json : Buffer.from(json, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (keyPath) return JSON.parse(readFileSync(keyPath, "utf8"));
  return null;
}

function getMessaging(): import("firebase-admin/messaging").Messaging | null {
  if (messagingInstance) return messagingInstance;
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      if (!warnedMissingConfig) {
        console.log(
          "FIREBASE_SERVICE_ACCOUNT_JSON/_PATH niet gezet — pushmeldingen staan uit (WebSocket-meldingen werken gewoon door)."
        );
        warnedMissingConfig = true;
      }
      return null;
    }
    // Lazy require: keeps firebase-admin's SDK init (and its own network
    // calls) out of the startup path entirely when push isn't configured.
    const { initializeApp, cert } = require("firebase-admin/app") as typeof import("firebase-admin/app");
    const { getMessaging: getMessagingSdk } = require("firebase-admin/messaging") as typeof import("firebase-admin/messaging");
    const app = initializeApp({ credential: cert(serviceAccount) });
    messagingInstance = getMessagingSdk(app);
    return messagingInstance;
  } catch (err) {
    console.error("Kon firebase-admin niet initialiseren, pushmeldingen staan uit:", (err as Error).message);
    return null;
  }
}

export async function sendPushNotification(token: string, fromId: string, notification: NotificationPayload): Promise<void> {
  const m = getMessaging();
  if (!m) return;
  try {
    await m.send({
      token,
      // Data-only — deliberately no top-level "notification" block. That
      // block would make Android auto-display a plain system-tray entry
      // itself, on top of (duplicating) the one the app now displays via
      // notifee (see mobile/src/notifications.ts), which is what lets a
      // confirm-kind request pop up full-screen instead of sitting quietly
      // in the shade.
      data: {
        fromId,
        notification: JSON.stringify(notification),
      },
      android: { priority: "high" },
    });
  } catch (err) {
    console.error(`Push naar token kon niet verstuurd worden:`, (err as Error).message);
  }
}
