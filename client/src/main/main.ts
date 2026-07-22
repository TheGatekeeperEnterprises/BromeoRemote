import { app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, clipboard, nativeImage, Tray, Menu, Notification, screen } from "electron";
import { join } from "path";
import { writeFile, readFile, stat } from "fs/promises";
import { store, hashPassword, randomPassword } from "./store";
import { applyInputEvent } from "./input";
import { startBridge, resolvePending } from "./bridge";
import { sendMagicPacket } from "./wol";
import { lockComputer, restartComputer, setBlockInput, resizeAndFocusWindow } from "./system";
import { askAiBuddy, type AiBuddyMessage } from "./aiBuddy";
import { installSas, isSasInstalled, sendCtrlAltDel, uninstallSas } from "./sasControl";
import { setMonitorPower } from "./display";
import { generateSecret, buildOtpauthUri, verifyTotp } from "./totp";
import { autoUpdater } from "electron-updater";
import type { InputEvent, MonitorInfo, NotificationPayload, SavedDevice, UpdateStatus, WindowInfo } from "../shared/protocol";

let mainWindow: BrowserWindow | null = null;
let miniControllerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activeMonitorId: string | null = null;
// "control a program" mobile feature: when set, setDisplayMediaRequestHandler
// serves this specific window instead of a full screen.
let activeWindowId: string | null = null;
let miniControllerState: MiniControllerState | null = null;

// Electron/Chromium encodes window-type desktopCapturer sources on Windows
// as "window:<HWND>:0" — the number is the real HWND value.
function hwndFromWindowSourceId(id: string): number | null {
  const match = /^window:(\d+):/.exec(id);
  return match ? parseInt(match[1], 10) : null;
}

// Sizes+positions a window to fill as much of the primary display's work
// area as possible while matching the viewer's aspect ratio (so a portrait
// phone gets a tall window, landscape gets a wide one, not just whatever
// shape the window already happened to be).
function resizeActiveWindowToAspect(aspect: number): boolean {
  if (!activeWindowId) return false;
  const hwnd = hwndFromWindowSourceId(activeWindowId);
  if (hwnd == null) return false;
  const work = screen.getPrimaryDisplay().workArea;
  let width: number;
  let height: number;
  if (aspect <= work.width / work.height) {
    height = work.height;
    width = Math.round(height * aspect);
  } else {
    width = work.width;
    height = Math.round(width / aspect);
  }
  width = Math.min(width, work.width);
  height = Math.min(height, work.height);
  const x = work.x + Math.round((work.width - width) / 2);
  const y = work.y + Math.round((work.height - height) / 2);
  return resizeAndFocusWindow(hwnd, x, y, width, height);
}

interface MiniControllerState {
  peer: string;
  status: string;
  permissions: string;
  canClipboard: boolean;
  canScreenPower: boolean;
  screenOff: boolean;
}

// Rotates every launch (and on-demand via the panic button) — this is the
// "quick support" password shown on screen, separate from the optional fixed
// unattended-access password in the store.
let sessionPassword = randomPassword(6);

function createWindow(): void {
  const iconPath = join(__dirname, "../../assets/icon.png");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: "BromeoRemote",
    icon: iconPath,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  try {
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip("BromeoRemote");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "BromeoRemote openen", click: () => mainWindow?.show() },
        { type: "separator" },
        { label: "Afsluiten", click: () => app.quit() },
      ])
    );
  } catch {
    // Tray icon is a nice-to-have; never block app startup on it.
  }
}

function restoreMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function positionMiniController(offscreen = false): { x: number; y: number } {
  const win = miniControllerWindow;
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = win?.getSize() ?? [360, 230];
  return {
    x: x + width - (offscreen ? 36 : windowWidth + 12),
    y: y + Math.max(76, Math.round((height - windowHeight) / 3)),
  };
}

function createMiniControllerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 230,
    minWidth: 320,
    minHeight: 210,
    maxWidth: 420,
    maxHeight: 280,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(__dirname, "../renderer/mini.html"));
  win.on("closed", () => {
    miniControllerWindow = null;
  });
  return win;
}

function sendMiniControllerState(): void {
  if (miniControllerWindow && miniControllerState) {
    miniControllerWindow.webContents.send("mini-controller-state", miniControllerState);
  }
}

function showMiniController(state: MiniControllerState): void {
  miniControllerState = state;
  if (!miniControllerWindow) miniControllerWindow = createMiniControllerWindow();
  const win = miniControllerWindow;
  win.setAlwaysOnTop(true, "screen-saver");
  const start = positionMiniController(true);
  const end = positionMiniController(false);
  win.setPosition(start.x, start.y, false);
  win.showInactive();
  win.webContents.once("did-finish-load", sendMiniControllerState);
  sendMiniControllerState();

  let step = 0;
  const totalSteps = 10;
  const timer = setInterval(() => {
    step++;
    const t = 1 - Math.pow(1 - step / totalSteps, 3);
    const nextX = Math.round(start.x + (end.x - start.x) * t);
    win.setPosition(nextX, end.y, false);
    if (step >= totalSteps) clearInterval(timer);
  }, 14);
}

function updateMiniController(state: MiniControllerState): void {
  miniControllerState = state;
  sendMiniControllerState();
}

function hideMiniController(): void {
  miniControllerState = null;
  miniControllerWindow?.hide();
}

function sendUpdateStatus(update: UpdateStatus): void {
  mainWindow?.webContents.send("update-status", update);
}

// electron-builder sets this env var when running the portable .exe. A
// portable build has no fixed install location to replace itself in — auto-
// update is only meaningful for the NSIS-installed build.
function isPortableBuild(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
}

function setupAutoUpdater(): void {
  // electron-updater looks for app-update.yml which only exists in a packaged
  // build — running it under `npm start` in dev just produces noisy errors.
  if (!app.isPackaged || isPortableBuild()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ status: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateStatus({ status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ status: "not-available" }));
  autoUpdater.on("download-progress", (p) => sendUpdateStatus({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({ status: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => sendUpdateStatus({ status: "error", error: err.message }));
  // Deliberately no immediate checkForUpdates() call here: it would race the
  // renderer's onUpdateStatus listener (page still loading) and the result
  // would be silently lost. The renderer triggers the first check itself,
  // once it has finished loading and is guaranteed to be listening.
}

ipcMain.handle("bromeo:get-app-version", () => app.getVersion());

ipcMain.handle("bromeo:check-for-updates", () => {
  if (!app.isPackaged) {
    sendUpdateStatus({ status: "error", error: "Updates zijn alleen beschikbaar in de geïnstalleerde versie." });
    return false;
  }
  if (isPortableBuild()) {
    sendUpdateStatus({ status: "error", error: "De portable versie werkt zichzelf niet bij — download de installer voor automatische updates." });
    return false;
  }
  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus({ status: "error", error: err.message }));
  return true;
});

ipcMain.handle("bromeo:install-update", () => {
  autoUpdater.quitAndInstall();
  return true;
});

ipcMain.handle("bromeo:show-mini-controller", (_e, state: MiniControllerState) => {
  showMiniController(state);
  mainWindow?.minimize();
  return true;
});

ipcMain.handle("bromeo:update-mini-controller", (_e, state: MiniControllerState) => {
  updateMiniController(state);
  return true;
});

ipcMain.handle("bromeo:hide-mini-controller", () => {
  hideMiniController();
  return true;
});

ipcMain.handle("bromeo:restore-main-window", () => {
  restoreMainWindow();
  return true;
});

ipcMain.handle("bromeo:mini-controller-action", (_e, action: string) => {
  if (action === "open") restoreMainWindow();
  else mainWindow?.webContents.send("mini-controller-action", action);
  return true;
});

function setupDisplayMediaHandler(): void {
  // Lets renderer call navigator.mediaDevices.getDisplayMedia() with no extra
  // prompting UI of our own — we hand it the primary display (or whichever
  // monitor the viewer last picked) directly, since the BromeoRemote
  // accept/decline dialog is already the consent gate.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    if (activeWindowId) {
      const windowSources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1, height: 1 } });
      const chosenWindow = windowSources.find((s) => s.id === activeWindowId);
      if (chosenWindow) {
        callback({ video: chosenWindow, audio: "loopback" });
        return;
      }
      // The window closed since it was picked — fall back to the desktop.
      activeWindowId = null;
    }
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
    const chosen = sources.find((s) => s.id === activeMonitorId) ?? sources[0];
    if (chosen) callback({ video: chosen, audio: "loopback" });
    else callback({});
  });
}

ipcMain.handle("bromeo:get-config", () => {
  const cfg = store.get();
  return {
    deviceId: cfg.deviceId,
    deviceLabel: cfg.deviceLabel,
    unattendedEnabled: cfg.unattendedEnabled,
    hasUnattendedPassword: !!cfg.unattendedPasswordHash,
    theme: cfg.theme,
    notifyForwardId: cfg.notifyForwardId,
    curtainModeEnabled: cfg.curtainModeEnabled,
    totpEnabled: cfg.totpEnabled,
    sessionPassword,
  };
});

ipcMain.handle("bromeo:set-notify-forward", (_e, targetId: string | null) => {
  const updated = store.update({ notifyForwardId: targetId && targetId.trim() ? targetId.trim() : null });
  return updated.notifyForwardId;
});

ipcMain.handle("bromeo:set-device-label", (_e, label: string) => {
  const cleaned = label.trim().slice(0, 60);
  const updated = store.update({ deviceLabel: cleaned || store.get().deviceLabel });
  return updated.deviceLabel;
});

ipcMain.handle("bromeo:set-curtain-mode", (_e, enabled: boolean) => {
  const updated = store.update({ curtainModeEnabled: enabled });
  return updated.curtainModeEnabled;
});

ipcMain.handle("bromeo:set-monitor-power", (_e, on: boolean) => {
  setMonitorPower(on);
  return true;
});

// "AI Buddy" — the key itself never leaves the main process (never sent to
// the renderer), and the OpenAI call itself also happens here (see
// aiBuddy.ts) rather than in the renderer, avoiding both key exposure and
// any renderer-side CORS considerations.
ipcMain.handle("bromeo:set-openai-key", (_e, key: string | null) => {
  store.setOpenAiApiKey(key && key.trim() ? key.trim() : null);
  return !!store.getOpenAiApiKey();
});

ipcMain.handle("bromeo:get-openai-key-status", () => !!store.getOpenAiApiKey());

ipcMain.handle("bromeo:ask-ai-buddy", (_e, history: AiBuddyMessage[]) => askAiBuddy(history));

// Kept only in memory during enrollment — never written to disk until the
// user proves their authenticator app produces a matching code.
let pendingTotpSecret: string | null = null;

ipcMain.handle("bromeo:generate-totp-secret", () => {
  pendingTotpSecret = generateSecret();
  return { secret: pendingTotpSecret, otpauthUri: buildOtpauthUri(pendingTotpSecret, store.get().deviceId) };
});

ipcMain.handle("bromeo:enable-totp", (_e, code: string) => {
  if (!pendingTotpSecret || !verifyTotp(pendingTotpSecret, code)) return { ok: false };
  store.setTotpSecret(pendingTotpSecret);
  store.update({ totpEnabled: true });
  pendingTotpSecret = null;
  return { ok: true };
});

ipcMain.handle("bromeo:disable-totp", () => {
  store.setTotpSecret(null);
  return true;
});

ipcMain.handle("bromeo:bridge-decision", (_e, id: string, decision: "allow" | "deny") => {
  return resolvePending(id, decision);
});

ipcMain.handle("bromeo:get-saved-devices", () => store.getSavedDevices());

ipcMain.handle("bromeo:save-device", (_e, device: SavedDevice) => {
  const list = store.getSavedDevices().filter((d) => d.id !== device.id);
  list.unshift(device);
  store.setSavedDevices(list);
  return list;
});

ipcMain.handle("bromeo:remove-saved-device", (_e, id: string) => {
  const list = store.getSavedDevices().filter((d) => d.id !== id);
  store.setSavedDevices(list);
  return list;
});

ipcMain.handle("bromeo:wake-device", async (_e, mac: string) => {
  try {
    await sendMagicPacket(mac);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle("bromeo:restart-computer", () => {
  restartComputer(10);
  return true;
});

ipcMain.handle("bromeo:lock-computer", () => {
  lockComputer();
  return true;
});

ipcMain.handle("bromeo:block-input", (_e, enabled: boolean) => setBlockInput(enabled));

ipcMain.handle("bromeo:sas-status", () => isSasInstalled());
ipcMain.handle("bromeo:sas-install", () => installSas());
ipcMain.handle("bromeo:sas-uninstall", () => uninstallSas());
ipcMain.handle("bromeo:send-ctrl-alt-del", () => sendCtrlAltDel());

ipcMain.handle("bromeo:list-monitors", async (): Promise<MonitorInfo[]> => {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
  return sources.map((s, i) => ({ id: s.id, label: s.name || `Scherm ${i + 1}` }));
});

ipcMain.handle("bromeo:set-active-monitor", (_e, monitorId: string) => {
  activeMonitorId = monitorId;
  activeWindowId = null;
  return true;
});

ipcMain.handle("bromeo:list-windows", async (): Promise<WindowInfo[]> => {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 160, height: 160 } });
  return sources
    // Excludes all of this app's own windows, not just the main one —
    // mini.html's title is "BromeoRemote sessiebediening", not "BromeoRemote",
    // so an exact match let the floating mini-controller widget itself show
    // up as a selectable "program."
    .filter((s) => s.name && s.name.trim() && !s.name.startsWith("BromeoRemote"))
    .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? undefined : s.thumbnail.toDataURL() }));
});

ipcMain.handle("bromeo:set-active-window", (_e, windowId: string, aspect: number) => {
  activeWindowId = windowId;
  return resizeActiveWindowToAspect(aspect);
});

ipcMain.handle("bromeo:resize-active-window", (_e, aspect: number) => resizeActiveWindowToAspect(aspect));

ipcMain.handle("bromeo:set-capture-desktop", () => {
  activeWindowId = null;
  return true;
});

ipcMain.handle("bromeo:set-unattended", (_e, enabled: boolean, password: string | null) => {
  const updated = store.update({
    unattendedEnabled: enabled,
    unattendedPasswordHash: password ? hashPassword(password) : store.get().unattendedPasswordHash,
  });
  return { unattendedEnabled: updated.unattendedEnabled, hasUnattendedPassword: !!updated.unattendedPasswordHash };
});

ipcMain.handle("bromeo:check-password", (_e, passwordHash: string, totpCode?: string) => {
  const cfg = store.get();
  if (passwordHash === hashPassword(sessionPassword)) return { ok: true, mode: "session" };
  if (cfg.unattendedEnabled && cfg.unattendedPasswordHash && passwordHash === cfg.unattendedPasswordHash) {
    if (cfg.totpEnabled) {
      const secret = store.getTotpSecret();
      if (!totpCode) return { ok: false, reason: "totp-required" };
      if (!secret || !verifyTotp(secret, totpCode)) return { ok: false, reason: "bad-totp" };
    }
    return { ok: true, mode: "unattended" };
  }
  return { ok: false };
});

ipcMain.handle("bromeo:regenerate-password", () => {
  sessionPassword = randomPassword(6);
  return sessionPassword;
});

ipcMain.handle("bromeo:set-theme", (_e, theme: "dark" | "light") => {
  store.update({ theme });
  return true;
});

ipcMain.handle("bromeo:apply-input", async (_e, event: InputEvent) => {
  await applyInputEvent(event);
  return true;
});

ipcMain.handle("bromeo:get-clipboard", () => clipboard.readText());
ipcMain.handle("bromeo:set-clipboard", (_e, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("bromeo:save-file", async (_e, suggestedName: string, base64Chunks: string[]) => {
  if (!mainWindow) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName });
  if (canceled || !filePath) return { ok: false };
  const buffer = Buffer.concat(base64Chunks.map((c) => Buffer.from(c, "base64")));
  await writeFile(filePath, buffer);
  return { ok: true, path: filePath };
});

ipcMain.handle("bromeo:pick-file", async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
  if (canceled || filePaths.length === 0) return null;
  const path = filePaths[0];
  const info = await stat(path);
  return { path, name: path.split(/[\\/]/).pop(), size: info.size };
});

ipcMain.handle("bromeo:read-file-base64", async (_e, path: string) => {
  const buf = await readFile(path);
  return buf.toString("base64");
});

ipcMain.handle("bromeo:save-recording", async (_e, data: Uint8Array, suggestedName: string) => {
  if (!mainWindow) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName,
    filters: [{ name: "WebM-video", extensions: ["webm"] }],
  });
  if (canceled || !filePath) return { ok: false };
  await writeFile(filePath, Buffer.from(data));
  return { ok: true, path: filePath };
});

function handleBridgeNotification(notification: NotificationPayload): void {
  // Forwarding is phone-only redirection, not a copy — see the matching
  // check in renderer/app.ts's handleBridgeNotification for the in-app
  // confirm dialog/toast side of this same behavior.
  if (Notification.isSupported() && !store.get().notifyForwardId) {
    new Notification({
      title: `${notification.source}: ${notification.title}`,
      body: notification.message,
      urgency: notification.kind === "confirm" ? "critical" : "normal",
    }).show();
  }
  mainWindow?.webContents.send("bridge:notification", notification);
}

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  createWindow();
  startBridge(handleBridgeNotification);
  setupAutoUpdater();
});

app.on("before-quit", () => {
  // Safety net: never let the app exit with the physical display left off,
  // or the local mouse/keyboard left blocked.
  setMonitorPower(true);
  setBlockInput(false);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
