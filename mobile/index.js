/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { displayLocalNotification } from './src/notifications';
import App from './App';
import { name as appName } from './app.json';

// Must be registered here (outside any component) — this is what lets a data
// message wake the app in the background at all. The server now sends
// data-only messages (see server/src/push.ts) instead of a "notification"
// block, so nothing is displayed automatically — this handler is what shows
// it, via notifee instead of the OS default, so confirm-kind pushes can pop
// up full-screen (see src/notifications.ts) instead of just sitting quietly
// in the notification shade.
setBackgroundMessageHandler(getMessaging(), async (remoteMessage) => {
  const data = remoteMessage.data;
  if (!data?.notification) return;
  try {
    await displayLocalNotification(data.fromId ?? '', JSON.parse(data.notification));
  } catch {
    // Malformed payload — nothing sensible to show.
  }
});

// Required registration point for notifee's own background events (e.g. a
// dismiss while the app isn't running) — presses that open the app are
// instead handled via getInitialNotificationPress/onNotificationPress in
// App.tsx, so this only needs to exist, not do anything itself.
notifee.onBackgroundEvent(async ({ type }) => {
  if (type === EventType.DISMISSED) {
    // Nothing to do — no server-side state tied to a dismissed notification.
  }
});

// SafeAreaProvider is required for react-native-safe-area-context's
// SafeAreaView (used throughout App.tsx) to work at all — without it, the
// plain react-native SafeAreaView it replaces silently no-ops on Android
// (it's essentially iOS-only), so content could render under the status bar
// / notch on some real devices, making anything there untappable.
function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent(appName, () => Root);
