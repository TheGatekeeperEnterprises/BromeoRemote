import { PermissionsAndroid, Platform } from "react-native";
import { getMessaging, getToken, onTokenRefresh, onMessage } from "@react-native-firebase/messaging";
import type { NotificationPayload } from "./shared/protocol";

const messaging = getMessaging();

export async function requestNotificationPermission(): Promise<void> {
  if (Platform.OS === "android" && Platform.Version >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
}

// Returns null when no real Firebase project is configured yet (placeholder
// google-services.json) or the device has no Play Services — callers should
// treat that as "push isn't available", not as an error.
export async function getPushToken(): Promise<string | null> {
  try {
    return await getToken(messaging);
  } catch {
    return null;
  }
}

export function onPushTokenRefresh(cb: (token: string) => void): () => void {
  return onTokenRefresh(messaging, cb);
}

// The server sends a data-only message (see server/src/push.ts) so the app
// can rebuild the exact same confirm/notify entry it would have gotten over
// the WebSocket. "Opened via notification" is handled separately, in
// src/notifications.ts — those events fire for notifications displayed via
// notifee (used so confirm-kind pushes can pop up full-screen), not ones
// Firebase would have auto-displayed, which is no longer applicable now that
// nothing sends a top-level "notification" block.
export function parsePushData(data: Record<string, string> | undefined): { fromId: string; notification: NotificationPayload } | null {
  if (!data?.notification) return null;
  try {
    return { fromId: data.fromId ?? "", notification: JSON.parse(data.notification) };
  } catch {
    return null;
  }
}

export function onForegroundPush(cb: (fromId: string, notification: NotificationPayload) => void): () => void {
  return onMessage(messaging, async (remoteMessage) => {
    const parsed = parsePushData(remoteMessage.data as Record<string, string> | undefined);
    if (parsed) cb(parsed.fromId, parsed.notification);
  });
}
