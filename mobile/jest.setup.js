/* eslint-env jest, commonjs */

const { NativeModules } = require('react-native');

global.WebSocket = class WebSocket {
  static OPEN = 1;

  readyState = WebSocket.OPEN;
  onopen = null;
  onerror = null;
  onclose = null;
  onmessage = null;

  send() {}
  close() {
    this.readyState = 3;
  }
};

NativeModules.RemoteControlModule = {
  isEnabled: jest.fn(() => Promise.resolve(false)),
  openSettings: jest.fn(),
  tap: jest.fn(),
  longPress: jest.fn(),
  swipePath: jest.fn(),
  scroll: jest.fn(),
};

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((key) => Promise.resolve(store.has(key) ? store.get(key) : null)),
    setItem: jest.fn((key, value) => {
      store.set(key, String(value));
      return Promise.resolve();
    }),
    removeItem: jest.fn((key) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys) => Promise.resolve(keys.map((key) => [key, store.has(key) ? store.get(key) : null]))),
    multiSet: jest.fn((entries) => {
      entries.forEach(([key, value]) => store.set(key, String(value)));
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys) => {
      keys.forEach((key) => store.delete(key));
      return Promise.resolve();
    }),
  };
});

jest.mock('react-native-webrtc', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    RTCView: (props) => React.createElement(View, props),
    MediaStream: class MediaStream {
      constructor(tracks = []) {
        this.tracks = tracks;
      }
      getTracks() {
        return this.tracks;
      }
      getVideoTracks() {
        return this.tracks.filter((track) => track.kind === 'video');
      }
      toURL() {
        return 'mock-stream';
      }
    },
    mediaDevices: {
      getDisplayMedia: jest.fn(() => Promise.resolve({ getTracks: () => [] })),
      getUserMedia: jest.fn(() => Promise.resolve({ getTracks: () => [] })),
    },
  };
});

jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Icon = (props) => React.createElement(View, props);
  return new Proxy(
    {},
    {
      get: () => Icon,
    },
  );
});

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(() => Promise.resolve(null)),
  onTokenRefresh: jest.fn(() => jest.fn()),
  onMessage: jest.fn(() => jest.fn()),
}));

jest.mock('@notifee/react-native', () => {
  const notifee = {
    createChannel: jest.fn(() => Promise.resolve()),
    openNotificationSettings: jest.fn(() => Promise.resolve()),
    displayNotification: jest.fn(() => Promise.resolve()),
    onForegroundEvent: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
  };
  return {
    __esModule: true,
    default: notifee,
    AndroidCategory: { CALL: 'call' },
    AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    AndroidVisibility: { PUBLIC: 1 },
    EventType: { PRESS: 1 },
  };
});

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  isErrorWithCode: jest.fn(() => false),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

jest.mock('react-native-blob-util', () => ({
  fs: {
    dirs: { DownloadDir: '/tmp' },
    readFile: jest.fn(() => Promise.resolve('')),
    writeFile: jest.fn(() => Promise.resolve()),
    scanFile: jest.fn(() => Promise.resolve()),
  },
}));
