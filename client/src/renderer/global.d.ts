import type { AiBuddyMessage, AiBuddyResult, CursorShapeName, InputEvent, MonitorInfo, NotificationPayload, SavedDevice, UpdateStatus, WindowInfo } from "../shared/protocol";

export interface BromeoConfig {
  deviceId: string;
  deviceLabel: string;
  unattendedEnabled: boolean;
  hasUnattendedPassword: boolean;
  theme: "dark" | "light";
  notifyForwardId: string | null;
  curtainModeEnabled: boolean;
  totpEnabled: boolean;
  sessionPassword: string;
}

export interface MiniControllerState {
  peer: string;
  status: string;
  permissions: string;
  canClipboard: boolean;
  canScreenPower: boolean;
  screenOff: boolean;
}

export interface BromeoBridge {
  getConfig(): Promise<BromeoConfig>;
  setUnattended(enabled: boolean, password: string | null): Promise<{ unattendedEnabled: boolean; hasUnattendedPassword: boolean }>;
  checkPassword(passwordHash: string, totpCode?: string): Promise<{ ok: boolean; mode?: "session" | "unattended"; reason?: string }>;
  regeneratePassword(): Promise<string>;
  setTheme(theme: "dark" | "light"): Promise<boolean>;

  applyInput(event: InputEvent): Promise<boolean>;

  getClipboard(): Promise<string>;
  setClipboard(text: string): Promise<boolean>;

  saveFile(suggestedName: string, base64Chunks: string[]): Promise<{ ok: boolean; path?: string }>;
  pickFile(): Promise<{ path: string; name: string; size: number } | null>;
  readFileBase64(path: string): Promise<string>;
  saveRecording(data: Uint8Array, suggestedName: string): Promise<{ ok: boolean; path?: string }>;

  setDeviceLabel(label: string): Promise<string>;
  setNotifyForward(targetId: string | null): Promise<string | null>;
  setCurtainMode(enabled: boolean): Promise<boolean>;
  setMonitorPower(on: boolean): Promise<boolean>;
  setOpenAiKey(key: string | null): Promise<boolean>;
  getOpenAiKeyStatus(): Promise<boolean>;
  askAiBuddy(history: AiBuddyMessage[]): Promise<AiBuddyResult>;
  generateTotpSecret(): Promise<{ secret: string; otpauthUri: string }>;
  enableTotp(code: string): Promise<{ ok: boolean }>;
  disableTotp(): Promise<boolean>;
  sendBridgeDecision(id: string, decision: "allow" | "deny"): Promise<boolean>;
  onBridgeNotification(cb: (notification: NotificationPayload) => void): () => void;

  getSavedDevices(): Promise<SavedDevice[]>;
  saveDevice(device: SavedDevice): Promise<SavedDevice[]>;
  removeSavedDevice(id: string): Promise<SavedDevice[]>;
  wakeDevice(mac: string): Promise<{ ok: boolean; error?: string }>;
  restartComputer(): Promise<boolean>;
  lockComputer(): Promise<boolean>;
  blockInput(enabled: boolean): Promise<boolean>;
  hideWallpaper(enabled: boolean): Promise<boolean>;
  getCursorShape(): Promise<CursorShapeName>;
  sasStatus(): Promise<boolean>;
  sasInstall(): Promise<boolean>;
  sasUninstall(): Promise<boolean>;
  sendCtrlAltDel(): Promise<boolean>;
  listMonitors(): Promise<MonitorInfo[]>;
  setActiveMonitor(monitorId: string): Promise<boolean>;
  listWindows(): Promise<WindowInfo[]>;
  setActiveWindow(windowId: string, aspect: number): Promise<boolean>;
  resizeActiveWindow(aspect: number): Promise<boolean>;
  setCaptureDesktop(): Promise<boolean>;
  setDualWindow(windowId1: string, windowId2: string, isPortrait: boolean): Promise<boolean>;
  resizeDualWindow(isPortrait: boolean): Promise<boolean>;

  getAppVersion(): Promise<string>;
  checkForUpdates(): Promise<boolean>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;

  showMiniController(state: MiniControllerState): Promise<boolean>;
  updateMiniController(state: MiniControllerState): Promise<boolean>;
  hideMiniController(): Promise<boolean>;
  restoreMainWindow(): Promise<boolean>;
  miniControllerAction(action: string): Promise<boolean>;
  onMiniControllerAction(cb: (action: string) => void): () => void;
  onMiniControllerState(cb: (state: MiniControllerState) => void): () => void;
}

declare global {
  interface Window {
    bromeo: BromeoBridge;
  }
}
