import { contextBridge, ipcRenderer } from "electron";
import type { AiBuddyMessage, InputEvent, NotificationPayload, SavedDevice, UpdateStatus } from "../shared/protocol";

interface MiniControllerViewer {
  peerId: string;
  label: string;
  permissions: string;
  viewOnly: boolean;
}

interface MiniControllerState {
  viewers: MiniControllerViewer[];
  canClipboard: boolean;
  canScreenPower: boolean;
  screenOff: boolean;
  whiteboardActive: boolean;
}

contextBridge.exposeInMainWorld("bromeo", {
  getConfig: () => ipcRenderer.invoke("bromeo:get-config"),
  verifyLicense: (key?: string, email?: string) => ipcRenderer.invoke("bromeo:verify-license", key, email),
  getLicenseStatus: () => ipcRenderer.invoke("bromeo:get-license-status"),
  openExternal: (url: string) => ipcRenderer.invoke("bromeo:open-external", url),
  reportSession: (payload: { deviceId: string; targetDeviceId?: string; platform: string; startedAt: number; endedAt: number }) =>
    ipcRenderer.invoke("bromeo:report-session", payload),
  reportSessionEvent: (data: { eventType: string; durationSeconds: number }) =>
    ipcRenderer.invoke("bromeo:report-session-event", data),
  setUnattended: (enabled: boolean, password: string | null) =>
    ipcRenderer.invoke("bromeo:set-unattended", enabled, password),
  checkPassword: (passwordHash: string, totpCode?: string, fromId?: string, fromLabel?: string, trustDevice?: boolean) =>
    ipcRenderer.invoke("bromeo:check-password", passwordHash, totpCode, fromId, fromLabel, trustDevice),
  regeneratePassword: () => ipcRenderer.invoke("bromeo:regenerate-password"),
  setTheme: (theme: "dark" | "light") => ipcRenderer.invoke("bromeo:set-theme", theme),

  applyInput: (event: InputEvent) => ipcRenderer.invoke("bromeo:apply-input", event),

  getClipboard: () => ipcRenderer.invoke("bromeo:get-clipboard"),
  setClipboard: (text: string) => ipcRenderer.invoke("bromeo:set-clipboard", text),

  saveFile: (suggestedName: string, base64Chunks: string[]) =>
    ipcRenderer.invoke("bromeo:save-file", suggestedName, base64Chunks),
  pickFile: () => ipcRenderer.invoke("bromeo:pick-file"),
  readFileBase64: (path: string) => ipcRenderer.invoke("bromeo:read-file-base64", path),
  saveRecording: (data: Uint8Array, suggestedName: string) =>
    ipcRenderer.invoke("bromeo:save-recording", data, suggestedName),

  setDeviceLabel: (label: string) => ipcRenderer.invoke("bromeo:set-device-label", label),
  setNotifyForward: (targetId: string | null) => ipcRenderer.invoke("bromeo:set-notify-forward", targetId),
  setCurtainMode: (enabled: boolean) => ipcRenderer.invoke("bromeo:set-curtain-mode", enabled),
  setMonitorPower: (on: boolean) => ipcRenderer.invoke("bromeo:set-monitor-power", on),
  setOpenAiKey: (key: string | null) => ipcRenderer.invoke("bromeo:set-openai-key", key),
  getOpenAiKeyStatus: () => ipcRenderer.invoke("bromeo:get-openai-key-status"),
  askAiBuddy: (history: AiBuddyMessage[]) => ipcRenderer.invoke("bromeo:ask-ai-buddy", history),
  generateTotpSecret: () => ipcRenderer.invoke("bromeo:generate-totp-secret"),
  enableTotp: (code: string) => ipcRenderer.invoke("bromeo:enable-totp", code),
  disableTotp: () => ipcRenderer.invoke("bromeo:disable-totp"),
  getTrustedDevices: () => ipcRenderer.invoke("bromeo:get-trusted-devices"),
  removeTrustedDevice: (id: string) => ipcRenderer.invoke("bromeo:remove-trusted-device", id),
  getSavedDevices: () => ipcRenderer.invoke("bromeo:get-saved-devices"),
  saveDevice: (device: SavedDevice) => ipcRenderer.invoke("bromeo:save-device", device),
  removeSavedDevice: (id: string) => ipcRenderer.invoke("bromeo:remove-saved-device", id),
  wakeDevice: (mac: string) => ipcRenderer.invoke("bromeo:wake-device", mac),
  restartComputer: () => ipcRenderer.invoke("bromeo:restart-computer"),
  lockComputer: () => ipcRenderer.invoke("bromeo:lock-computer"),
  blockInput: (enabled: boolean) => ipcRenderer.invoke("bromeo:block-input", enabled),
  hideWallpaper: (enabled: boolean) => ipcRenderer.invoke("bromeo:hide-wallpaper", enabled),
  getCursorShape: () => ipcRenderer.invoke("bromeo:get-cursor-shape"),
  sasStatus: () => ipcRenderer.invoke("bromeo:sas-status"),
  sasInstall: () => ipcRenderer.invoke("bromeo:sas-install"),
  sasUninstall: () => ipcRenderer.invoke("bromeo:sas-uninstall"),
  sendCtrlAltDel: () => ipcRenderer.invoke("bromeo:send-ctrl-alt-del"),
  listMonitors: () => ipcRenderer.invoke("bromeo:list-monitors"),
  setActiveMonitor: (monitorId: string) => ipcRenderer.invoke("bromeo:set-active-monitor", monitorId),
  listWindows: () => ipcRenderer.invoke("bromeo:list-windows"),
  setActiveWindow: (windowId: string, aspect: number) => ipcRenderer.invoke("bromeo:set-active-window", windowId, aspect),
  resizeActiveWindow: (aspect: number) => ipcRenderer.invoke("bromeo:resize-active-window", aspect),
  setCaptureDesktop: () => ipcRenderer.invoke("bromeo:set-capture-desktop"),
  setDualWindow: (windowId1: string, windowId2: string, aspect: number, isPortrait: boolean) => ipcRenderer.invoke("bromeo:set-dual-window", windowId1, windowId2, aspect, isPortrait),
  resizeDualWindow: (aspect: number, isPortrait: boolean) => ipcRenderer.invoke("bromeo:resize-dual-window", aspect, isPortrait),
  sendBridgeDecision: (id: string, decision: "allow" | "deny") =>
    ipcRenderer.invoke("bromeo:bridge-decision", id, decision),
  onBridgeNotification: (cb: (notification: NotificationPayload) => void) => {
    const listener = (_e: unknown, notification: NotificationPayload) => cb(notification);
    ipcRenderer.on("bridge:notification", listener);
    return () => ipcRenderer.removeListener("bridge:notification", listener);
  },

  getAppVersion: () => ipcRenderer.invoke("bromeo:get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("bromeo:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("bromeo:install-update"),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_e: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },

  showMiniController: (state: MiniControllerState) => ipcRenderer.invoke("bromeo:show-mini-controller", state),
  updateMiniController: (state: MiniControllerState) => ipcRenderer.invoke("bromeo:update-mini-controller", state),
  hideMiniController: () => ipcRenderer.invoke("bromeo:hide-mini-controller"),
  restoreMainWindow: () => ipcRenderer.invoke("bromeo:restore-main-window"),
  miniControllerAction: (action: string, peerId?: string) => ipcRenderer.invoke("bromeo:mini-controller-action", action, peerId),
  onMiniControllerAction: (cb: (action: string, peerId?: string) => void) => {
    const listener = (_e: unknown, action: string, peerId?: string) => cb(action, peerId);
    ipcRenderer.on("mini-controller-action", listener);
    return () => ipcRenderer.removeListener("mini-controller-action", listener);
  },
  onMiniControllerState: (cb: (state: MiniControllerState) => void) => {
    const listener = (_e: unknown, state: MiniControllerState) => cb(state);
    ipcRenderer.on("mini-controller-state", listener);
    return () => ipcRenderer.removeListener("mini-controller-state", listener);
  },
  onMiniControllerCollapsed: (cb: (collapsed: boolean) => void) => {
    const listener = (_e: unknown, collapsed: boolean) => cb(collapsed);
    ipcRenderer.on("mini-controller-collapsed", listener);
    return () => ipcRenderer.removeListener("mini-controller-collapsed", listener);
  },

  toggleHostAnnotationOverlay: () => ipcRenderer.invoke("bromeo:toggle-host-annotation-overlay"),
  closeHostAnnotationOverlay: () => ipcRenderer.invoke("bromeo:close-host-annotation-overlay"),
  sendHostAnnotationStroke: (id: string, points: { x: number; y: number }[], color: string) =>
    ipcRenderer.invoke("bromeo:host-annotation-stroke", id, points, color),
  sendHostAnnotationClear: () => ipcRenderer.invoke("bromeo:host-annotation-clear"),
  onHostAnnotationOverlayState: (cb: (active: boolean) => void) => {
    const listener = (_e: unknown, active: boolean) => cb(active);
    ipcRenderer.on("host-annotation-overlay-state", listener);
    return () => ipcRenderer.removeListener("host-annotation-overlay-state", listener);
  },
  onHostAnnotationStroke: (cb: (id: string, points: { x: number; y: number }[], color: string) => void) => {
    const listener = (_e: unknown, id: string, points: { x: number; y: number }[], color: string) => cb(id, points, color);
    ipcRenderer.on("host-annotation-stroke", listener);
    return () => ipcRenderer.removeListener("host-annotation-stroke", listener);
  },
  onHostAnnotationClear: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("host-annotation-clear", listener);
    return () => ipcRenderer.removeListener("host-annotation-clear", listener);
  },
});
