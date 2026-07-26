import { contextBridge, ipcRenderer } from "electron";
import type { AiBuddyMessage, InputEvent, NotificationPayload, SavedDevice, UpdateStatus } from "../shared/protocol";

interface MiniControllerState {
  peer: string;
  status: string;
  permissions: string;
  canClipboard: boolean;
  canScreenPower: boolean;
  screenOff: boolean;
}

contextBridge.exposeInMainWorld("bromeo", {
  getConfig: () => ipcRenderer.invoke("bromeo:get-config"),
  setUnattended: (enabled: boolean, password: string | null) =>
    ipcRenderer.invoke("bromeo:set-unattended", enabled, password),
  checkPassword: (passwordHash: string, totpCode?: string) => ipcRenderer.invoke("bromeo:check-password", passwordHash, totpCode),
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
  miniControllerAction: (action: string) => ipcRenderer.invoke("bromeo:mini-controller-action", action),
  onMiniControllerAction: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on("mini-controller-action", listener);
    return () => ipcRenderer.removeListener("mini-controller-action", listener);
  },
  onMiniControllerState: (cb: (state: MiniControllerState) => void) => {
    const listener = (_e: unknown, state: MiniControllerState) => cb(state);
    ipcRenderer.on("mini-controller-state", listener);
    return () => ipcRenderer.removeListener("mini-controller-state", listener);
  },
});
