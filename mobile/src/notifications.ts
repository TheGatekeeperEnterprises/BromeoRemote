import notifee, { AndroidCategory, AndroidImportance, AndroidVisibility, EventType } from "@notifee/react-native";
import type { NotificationPayload } from "./shared/protocol";

// Owns *how* a push actually appears on screen — split out from push.ts
// (which just owns FCM token/message plumbing) because this is what had to
// change to get a true full-screen popup (like an incoming call) instead of
// relying on Firebase's own automatic display of the "notification" block,
// which only ever produced a quiet notification-shade entry.
export const CONFIRM_CHANNEL_ID = "bromeo-confirm";
const INFO_CHANNEL_ID = "bromeo-info";

export async function ensureNotificationChannels(): Promise<void> {
  await notifee.createChannel({
    id: CONFIRM_CHANNEL_ID,
    name: "Bevestigingen",
    description: "Urgente bevestigingsverzoeken van agent-tools (bijv. Antigravity) — verschijnt als volledig scherm, ook als de telefoon vergrendeld is.",
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: "default",
  });
  await notifee.createChannel({
    id: INFO_CHANNEL_ID,
    name: "Meldingen",
    description: "Informatieve meldingen van agent-tools.",
    importance: AndroidImportance.DEFAULT,
  });
}

// A channel's sound/vibration/importance can't be changed programmatically
// once created (Android locks it down after first creation, by design, so
// apps can't quietly make themselves noisier) — this opens the OS's own
// per-channel settings screen, the standard way for a user to pick their
// own sound.
export function openConfirmNotificationSettings(): Promise<void> {
  return notifee.openNotificationSettings(CONFIRM_CHANNEL_ID);
}

function parseNotifeeData(data: Record<string, unknown> | undefined): { fromId: string; notification: NotificationPayload } | null {
  if (!data || typeof data.notification !== "string") return null;
  try {
    return { fromId: typeof data.fromId === "string" ? data.fromId : "", notification: JSON.parse(data.notification) };
  } catch {
    return null;
  }
}

// Called from the FCM background handler (index.js) for backgrounded/killed
// deliveries. A confirm-kind notification gets a full-screen action (needs
// android.permission.USE_FULL_SCREEN_INTENT, declared in AndroidManifest.xml)
// so it interrupts like an incoming call even over the lock screen; anything
// else is a normal heads-up-capable notification.
export async function displayLocalNotification(fromId: string, notification: NotificationPayload): Promise<void> {
  const isConfirm = notification.kind === "confirm";
  await notifee.displayNotification({
    id: notification.id,
    title: `${notification.source}: ${notification.title}`,
    body: notification.message,
    data: { fromId, notification: JSON.stringify(notification) },
    android: {
      channelId: isConfirm ? CONFIRM_CHANNEL_ID : INFO_CHANNEL_ID,
      importance: isConfirm ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
      category: isConfirm ? AndroidCategory.CALL : undefined,
      pressAction: { id: "default" },
      ...(isConfirm ? { fullScreenAction: { id: "default" } } : {}),
      autoCancel: true,
    },
  });
}

// Fires when the user presses a notifee-displayed notification while the app
// is already running (foreground or background) — replaces Firebase
// Messaging's onNotificationOpenedApp, which only ever fired for
// Firebase-auto-displayed notifications, not ones we display ourselves.
export function onNotificationPress(cb: (fromId: string, notification: NotificationPayload) => void): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      const parsed = parseNotifeeData(detail.notification?.data as Record<string, unknown> | undefined);
      if (parsed) cb(parsed.fromId, parsed.notification);
    }
  });
}

// App was fully killed and got launched by tapping the notification —
// replaces Firebase Messaging's getInitialNotification for the same reason
// as onNotificationPress above.
export async function getInitialNotificationPress(): Promise<{ fromId: string; notification: NotificationPayload } | null> {
  const initial = await notifee.getInitialNotification();
  if (!initial) return null;
  return parseNotifeeData(initial.notification.data as Record<string, unknown> | undefined);
}
