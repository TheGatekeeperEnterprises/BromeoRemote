import { app, BrowserWindow, session, desktopCapturer, ipcMain, dialog, clipboard, nativeImage, Tray, Menu, Notification, screen, shell } from "electron";
import { join } from "path";
import { writeFile, readFile, stat } from "fs/promises";
import { appendFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { hostname, cpus, networkInterfaces } from "os";
import { store, hashPassword, randomPassword } from "./store";
import { applyInputEvent } from "./input";
import { startBridge, resolvePending } from "./bridge";
import { sendMagicPacket } from "./wol";
import { lockComputer, restartComputer, setBlockInput, resizeAndFocusWindow, bringWindowToFront, hideWallpaper, restoreWallpaper, getCursorShape, getWindowBounds } from "./system";
import { askAiBuddy, type AiBuddyMessage } from "./aiBuddy";
import { installSas, isSasInstalled, sendCtrlAltDel, uninstallSas } from "./sasControl";
import { setMonitorPower } from "./display";
import { generateSecret, buildOtpauthUri, verifyTotp } from "./totp";
import QRCode from "qrcode";
import { autoUpdater } from "electron-updater";
import type { AnnotationShape, InputEvent, MonitorInfo, NotificationPayload, SavedDevice, UpdateStatus, WindowInfo } from "../shared/protocol";

let mainWindow: BrowserWindow | null = null;
let miniControllerWindow: BrowserWindow | null = null;
let miniControllerCollapsed = false;
let hostAnnotationWindow: BrowserWindow | null = null;
let hostAnnotationOverlayActive = false;
let hostChatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let activeMonitorId: string | null = null;
// "control a program" mobile feature: when set, setDisplayMediaRequestHandler
// serves this specific window instead of a full screen.
let activeWindowId: string | null = null;
let miniControllerState: MiniControllerState | null = null;

let activeDualBounds: { x: number; y: number; width: number; height: number } | null = null;

// Temporary diagnostic for the desktop-to-desktop cross-network black-screen
// investigation (see docs/WEBRTC-TURN-DEBUGGING.md) — renderer console.log
// output isn't visible anywhere without DevTools open, so mirror every
// "[ice] ..." line to a plain-text file that can be read after a repro
// without needing to walk the user through opening DevTools themselves.
// Truncated fresh on every launch (see createWindow) so a log always
// corresponds to just the most recent run.
const iceLogPath = join(app.getPath("userData"), "ice-debug.log");
function logIceLine(message: string): void {
  try {
    appendFileSync(iceLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch {
    // Best-effort diagnostic only — never let a logging failure affect the app.
  }
}

export function getActiveAppWindowBounds(): { x: number; y: number; width: number; height: number } | null {
  if (activeDualWindows && activeDualBounds) return activeDualBounds;
  if (!activeWindowId) return null;
  const hwnd = hwndFromWindowSourceId(activeWindowId);
  if (hwnd == null) return null;
  return getWindowBounds(hwnd);
}

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
let activeDualWindows: { windowId1: string; windowId2: string } | null = null;

// resizeAndFocusWindow only brings a window forward once, at the moment
// it's called (initial switch, or a rotation-triggered resize) — nothing
// re-asserts it afterward, so any other window the user (or another app)
// clicks locally can cover it again a moment later, even though the viewer
// is still supposed to be seeing exactly this window. This loop keeps
// re-stacking whichever window(s) are the current share target to the top
// for as long as single/dual-window mode is active, so what the viewer
// sees always matches what's actually in front on the real screen.
let keepForegroundTimer: ReturnType<typeof setInterval> | null = null;

function startKeepForegroundLoop(): void {
  if (keepForegroundTimer) return;
  keepForegroundTimer = setInterval(() => {
    if (activeDualWindows) {
      const hwnd1 = hwndFromWindowSourceId(activeDualWindows.windowId1);
      const hwnd2 = hwndFromWindowSourceId(activeDualWindows.windowId2);
      if (hwnd1 != null) bringWindowToFront(hwnd1);
      if (hwnd2 != null) bringWindowToFront(hwnd2);
    } else if (activeWindowId) {
      const hwnd = hwndFromWindowSourceId(activeWindowId);
      if (hwnd != null) bringWindowToFront(hwnd);
    } else {
      stopKeepForegroundLoop();
    }
  }, 1500);
}

function stopKeepForegroundLoop(): void {
  if (keepForegroundTimer) clearInterval(keepForegroundTimer);
  keepForegroundTimer = null;
}

function tileDualWindows(windowId1: string, windowId2: string, aspect: number, isPortrait: boolean): { x: number; y: number; width: number; height: number } | null {
  const hwnd1 = hwndFromWindowSourceId(windowId1);
  const hwnd2 = hwndFromWindowSourceId(windowId2);
  if (hwnd1 == null || hwnd2 == null) return null;
  const work = screen.getPrimaryDisplay().workArea;

  // Same aspect-locked sizing as resizeActiveWindowToAspect (single-window
  // mode below) — fit a box matching the viewer's own aspect ratio within
  // the work area, centered, instead of splitting the whole (arbitrarily
  // monitor-shaped, e.g. 16:9) work area in half. Without this, the
  // captured region stayed whatever shape the monitor happened to be
  // regardless of the phone's orientation — a portrait phone had to
  // letterbox it heavily, so the two tiled windows ended up small in the
  // middle of a mostly-black screen instead of filling it edge to edge.
  let boxWidth: number;
  let boxHeight: number;
  if (aspect <= work.width / work.height) {
    boxHeight = work.height;
    boxWidth = Math.round(boxHeight * aspect);
  } else {
    boxWidth = work.width;
    boxHeight = Math.round(boxWidth / aspect);
  }
  boxWidth = Math.min(boxWidth, work.width);
  boxHeight = Math.min(boxHeight, work.height);
  const boxX = work.x + Math.round((work.width - boxWidth) / 2);
  const boxY = work.y + Math.round((work.height - boxHeight) / 2);

  if (isPortrait) {
    // PORTRAIT MODE: Window 1 is TOP half, Window 2 is BOTTOM half — of the
    // aspect-locked box, not the raw work area.
    const halfH = Math.floor(boxHeight / 2);
    resizeAndFocusWindow(hwnd1, boxX, boxY, boxWidth, halfH);
    resizeAndFocusWindow(hwnd2, boxX, boxY + halfH, boxWidth, boxHeight - halfH);
  } else {
    // LANDSCAPE MODE: Window 1 is LEFT half, Window 2 is RIGHT half.
    const halfW = Math.floor(boxWidth / 2);
    resizeAndFocusWindow(hwnd1, boxX, boxY, halfW, boxHeight);
    resizeAndFocusWindow(hwnd2, boxX + halfW, boxY, boxWidth - halfW, boxHeight);
  }

  // This box (not the full work area) is both the input-coordinate-mapping
  // bounds (getActiveAppWindowBounds, used by input.ts) and, via the
  // returned value here, the exact region the renderer crops the raw
  // full-monitor capture down to (see createCroppedStream's call sites in
  // app.ts) — the two windows exactly fill it, so cropping to it is what
  // makes the final video "locked" to just the two windows at the phone's
  // own aspect ratio, matching how single-window mode's window capture is
  // naturally already cropped to just that one window by Chromium itself.
  activeDualBounds = { x: boxX, y: boxY, width: boxWidth, height: boxHeight };
  return activeDualBounds;
}

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
      // The whole point of this app is running while its own window sits
      // unfocused/minimized in the background (the user is controlling it
      // from their phone) — Chromium's default background throttling would
      // slow requestAnimationFrame down to near-zero in that exact state,
      // which is what dual-window mode's canvas-based crop loop
      // (createCroppedStream, app.ts) runs on. Without this, the shared
      // video visibly freezes the moment the window loses focus, even
      // though the real desktop keeps updating normally underneath it.
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  try {
    writeFileSync(iceLogPath, "", "utf-8"); // fresh log per launch, see logIceLine's comment
  } catch {
    // Non-fatal — logIceLine's own try/catch handles the rest.
  }
  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    if (message.startsWith("[ice]")) logIceLine(message);
  });

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

// TeamViewer-style edge collapse: the panel slides mostly offscreen to a
// tiny tab, and back, by animating both size and position together — see
// toggleMiniControllerCollapse. Kept as constants (rather than reading
// win.getSize()) so the y-position math below always anchors to the
// expanded panel's height, avoiding a vertical jump between the two sizes.
// 356 fits the header + viewer list + meta box + all 4 action rows (Klembord/
// Chat, Scherm/Whiteboard, End-all, Panic) without clipping — the panel used
// to be 230, which was too short to reach the red end-session button at all.
const MINI_EXPANDED_SIZE = { width: 360, height: 356 };
const MINI_COLLAPSED_SIZE = { width: 26, height: 64 };

function miniControllerY(): number {
  const display = screen.getPrimaryDisplay();
  const { y, height } = display.workArea;
  return y + Math.max(76, Math.round((height - MINI_EXPANDED_SIZE.height) / 3));
}

function positionMiniController(width: number, offscreen = false): { x: number; y: number } {
  const display = screen.getPrimaryDisplay();
  const { x, width: workWidth } = display.workArea;
  return {
    x: x + workWidth - (offscreen ? Math.min(36, width) : width + 12),
    y: miniControllerY(),
  };
}

function createMiniControllerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: MINI_EXPANDED_SIZE.width,
    height: MINI_EXPANDED_SIZE.height,
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
  // Keeps the docked chat window glued underneath if the user drags the
  // panel around (it's movable: true above).
  win.on("moved", () => {
    if (hostChatWindow?.isVisible()) hostChatWindow.setBounds(hostChatWindowBounds());
  });
  return win;
}

function sendMiniControllerState(): void {
  if (miniControllerWindow && miniControllerState) {
    miniControllerWindow.webContents.send("mini-controller-state", miniControllerState);
  }
}

function sendMiniControllerCollapsed(): void {
  miniControllerWindow?.webContents.send("mini-controller-collapsed", miniControllerCollapsed);
}

function showMiniController(state: MiniControllerState): void {
  miniControllerState = state;
  if (!miniControllerWindow) miniControllerWindow = createMiniControllerWindow();
  const win = miniControllerWindow;
  win.setAlwaysOnTop(true, "screen-saver");
  miniControllerCollapsed = false;
  const { width, height } = MINI_EXPANDED_SIZE;
  const start = positionMiniController(width, true);
  const end = positionMiniController(width, false);
  win.setBounds({ x: start.x, y: start.y, width, height }, false);
  win.showInactive();
  win.webContents.once("did-finish-load", () => {
    sendMiniControllerState();
    sendMiniControllerCollapsed();
  });
  sendMiniControllerState();
  sendMiniControllerCollapsed();

  let step = 0;
  const totalSteps = 10;
  const timer = setInterval(() => {
    step++;
    const t = 1 - Math.pow(1 - step / totalSteps, 3);
    const nextX = Math.round(start.x + (end.x - start.x) * t);
    win.setBounds({ x: nextX, y: end.y, width, height }, false);
    if (step >= totalSteps) clearInterval(timer);
  }, 14);
}

function toggleMiniControllerCollapse(): void {
  const win = miniControllerWindow;
  if (!win) return;
  miniControllerCollapsed = !miniControllerCollapsed;
  const targetSize = miniControllerCollapsed ? MINI_COLLAPSED_SIZE : MINI_EXPANDED_SIZE;
  const startBounds = win.getBounds();
  const target = positionMiniController(targetSize.width, false);
  sendMiniControllerCollapsed();
  // A docked chat window floating next to a collapsed tiny tab would look
  // disconnected — hide it; expanding the panel again doesn't auto-reopen
  // it, same as it wasn't open before collapsing.
  if (miniControllerCollapsed) hideHostChatWindow();

  let step = 0;
  const totalSteps = 10;
  const timer = setInterval(() => {
    step++;
    const t = 1 - Math.pow(1 - step / totalSteps, 3);
    win.setBounds(
      {
        x: Math.round(startBounds.x + (target.x - startBounds.x) * t),
        y: Math.round(startBounds.y + (target.y - startBounds.y) * t),
        width: Math.round(startBounds.width + (targetSize.width - startBounds.width) * t),
        height: Math.round(startBounds.height + (targetSize.height - startBounds.height) * t),
      },
      false
    );
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
  // Never leave the full-screen, mouse-capturing draw overlay orphaned once
  // the session that could show it ends — that would lock the host out of
  // their own desktop with no way back in.
  if (hostAnnotationOverlayActive) setHostAnnotationOverlayActive(false);
  hideHostChatWindow();
}

// --- Docked host chat window — floats directly under the mini controller
// panel (not the main window) so replying doesn't interrupt whatever the
// viewer is currently looking at. Mirrors app.ts's chatLog 1:1: app.ts still
// owns all chat state/sending, this is purely a second display surface for
// it plus a text box that round-trips a typed message back through main.ts.
const HOST_CHAT_SIZE = { width: 360, height: 300 };

interface HostChatMessage {
  text: string;
  timestamp: number;
  mine: boolean;
}

function hostChatWindowBounds(): { x: number; y: number; width: number; height: number } {
  const miniBounds = miniControllerWindow?.getBounds() ?? {
    x: 0,
    y: 0,
    width: MINI_EXPANDED_SIZE.width,
    height: MINI_EXPANDED_SIZE.height,
  };
  return {
    x: miniBounds.x + miniBounds.width - HOST_CHAT_SIZE.width,
    y: miniBounds.y + miniBounds.height + 8,
    width: HOST_CHAT_SIZE.width,
    height: HOST_CHAT_SIZE.height,
  };
}

function createHostChatWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...hostChatWindowBounds(),
    frame: false,
    resizable: false,
    movable: false,
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
  win.loadFile(join(__dirname, "../renderer/host-chat.html"));
  win.on("closed", () => {
    hostChatWindow = null;
  });
  return win;
}

function showHostChatWindow(): void {
  if (!miniControllerWindow || miniControllerCollapsed) return;
  if (!hostChatWindow) hostChatWindow = createHostChatWindow();
  hostChatWindow.setBounds(hostChatWindowBounds());
  hostChatWindow.setAlwaysOnTop(true, "screen-saver");
  hostChatWindow.showInactive();
}

function hideHostChatWindow(): void {
  hostChatWindow?.hide();
}

function sendHostChatMessages(messages: HostChatMessage[]): void {
  hostChatWindow?.webContents.send("host-chat-messages", messages);
}

function primaryDisplayBounds(): { x: number; y: number; width: number; height: number } {
  return screen.getPrimaryDisplay().bounds;
}

function createHostAnnotationWindow(): BrowserWindow {
  const bounds = primaryDisplayBounds();
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(join(__dirname, "../renderer/host-annotate.html"));
  win.on("closed", () => {
    hostAnnotationWindow = null;
  });
  return win;
}

// Toggled from the mini controller's Whiteboard button (host draws on their
// own screen; strokes get relayed to every viewer — see broadcastSystemCommand
// in app.ts) and from the overlay's own close button. mainWindow is notified
// either way so it can keep hostWhiteboardActive (and the mini controller's
// button state) in sync regardless of which side triggered the change.
function setHostAnnotationOverlayActive(active: boolean): void {
  hostAnnotationOverlayActive = active;
  if (active) {
    if (!hostAnnotationWindow) hostAnnotationWindow = createHostAnnotationWindow();
    hostAnnotationWindow.setBounds(primaryDisplayBounds());
    hostAnnotationWindow.setAlwaysOnTop(true, "screen-saver");
    hostAnnotationWindow.show();
  } else {
    hostAnnotationWindow?.hide();
  }
  mainWindow?.webContents.send("host-annotation-overlay-state", active);
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

function formatUpdateError(err: any): string {
  const msg = String(err?.message || err || "");
  if (msg.includes("404") || msg.includes("releases.atom") || msg.includes("cannot find") || msg.includes("ERR_NAME_NOT_RESOLVED")) {
    return "Je gebruikt de nieuwste versie.";
  }
  if (msg.includes("ENOTFOUND") || msg.includes("offline") || msg.includes("internet")) {
    return "Geen internetverbinding.";
  }
  return "Je gebruikt de nieuwste versie.";
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
  autoUpdater.on("error", (err) => sendUpdateStatus({ status: "error", error: formatUpdateError(err) }));
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
  autoUpdater.checkForUpdates().catch((err) => sendUpdateStatus({ status: "error", error: formatUpdateError(err) }));
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

ipcMain.handle("bromeo:mini-controller-action", (_e, action: string, peerId?: string) => {
  if (action === "open") restoreMainWindow();
  else if (action === "collapse") toggleMiniControllerCollapse();
  else mainWindow?.webContents.send("mini-controller-action", action, peerId);
  return true;
});

ipcMain.handle("bromeo:toggle-host-annotation-overlay", () => {
  setHostAnnotationOverlayActive(!hostAnnotationOverlayActive);
  return hostAnnotationOverlayActive;
});

ipcMain.handle("bromeo:close-host-annotation-overlay", () => {
  setHostAnnotationOverlayActive(false);
  return true;
});

ipcMain.handle("bromeo:host-annotation-shape", (_e, shape: AnnotationShape) => {
  mainWindow?.webContents.send("host-annotation-shape", shape);
  return true;
});

ipcMain.handle("bromeo:host-annotation-erase", (_e, id: string) => {
  mainWindow?.webContents.send("host-annotation-erase", id);
  return true;
});

ipcMain.handle("bromeo:host-annotation-clear", () => {
  mainWindow?.webContents.send("host-annotation-clear");
  return true;
});

ipcMain.handle("bromeo:save-host-annotation-image", async (_e, dataUrl: string, suggestedName: string) => {
  if (!hostAnnotationWindow) return { ok: false };
  const { canceled, filePath } = await dialog.showSaveDialog(hostAnnotationWindow, {
    defaultPath: suggestedName,
    filters: [{ name: "PNG-afbeelding", extensions: ["png"] }],
  });
  if (canceled || !filePath) return { ok: false };
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  await writeFile(filePath, Buffer.from(base64, "base64"));
  return { ok: true, path: filePath };
});

ipcMain.handle("bromeo:show-host-chat", () => {
  showHostChatWindow();
  return true;
});

ipcMain.handle("bromeo:update-host-chat", (_e, messages: HostChatMessage[]) => {
  sendHostChatMessages(messages);
  return true;
});

ipcMain.handle("bromeo:hide-host-chat", () => {
  hideHostChatWindow();
  return true;
});

ipcMain.handle("bromeo:host-chat-send", (_e, text: string) => {
  mainWindow?.webContents.send("host-chat-send", text);
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

function getClientHwid(): string {
  const cpuModel = cpus()[0]?.model || "";
  const net = JSON.stringify(networkInterfaces());
  const host = hostname();
  return createHash("sha256").update(`${host}-${cpuModel}-${net}`, "utf8").digest("hex");
}

async function verifyClientLicense(licenseKey?: string, email?: string) {
  try {
    const hwid = getClientHwid();
    const key = licenseKey !== undefined ? licenseKey.trim() : (store.get().licenseKey || "");
    const mail = email !== undefined ? email.trim() : (store.get().licenseEmail || "");

    if (!key && !mail) {
      const res = { valid: false, reason: "Geen licentie of e-mail ingevoerd." };
      store.setLicenseInfo(null, null, res);
      return res;
    }

    const response = await fetch("https://bromeoremote.com/api/license/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: key,
        email: mail,
        hwid,
        platform: process.platform,
        appVersion: app.getVersion(),
      }),
    });

    const data = await response.json();
    if (data.valid) {
      store.setLicenseInfo(key || null, mail || null, data);
      return data;
    } else {
      store.setLicenseInfo(key || null, mail || null, { valid: false, reason: data.reason });
      return { valid: false, reason: data.reason || "Ongeldige licentie." };
    }
  } catch (err: any) {
    const cached = store.get().licenseStatus;
    if (cached && cached.valid) {
      return cached;
    }
    return { valid: false, reason: "Kan licentieserver niet bereiken: " + (err.message || err) };
  }
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
    licenseKey: cfg.licenseKey,
    licenseEmail: cfg.licenseEmail,
    licenseStatus: cfg.licenseStatus,
  };
});

ipcMain.handle("bromeo:verify-license", (_e, key?: string, email?: string) => {
  return verifyClientLicense(key, email);
});

ipcMain.handle("bromeo:open-external", (_e, url: string) => {
  if (!/^https:\/\/(www\.)?bromeoremote\.com\//.test(url)) return false;
  void shell.openExternal(url);
  return true;
});

interface ReportSessionPayload {
  deviceId: string;
  targetDeviceId?: string;
  platform: string;
  startedAt: number;
  endedAt: number;
}

ipcMain.handle("bromeo:report-session", async (_e, payload: ReportSessionPayload) => {
  try {
    const cfg = store.get();
    await fetch("https://bromeoremote.com/api/session/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        licenseKey: cfg.licenseKey || undefined,
        email: cfg.licenseEmail || undefined,
      }),
    });
  } catch {
    // Fase 1 measurement only — never let a reporting failure surface to the user.
  }
});

ipcMain.handle("bromeo:get-license-status", () => {
  const cfg = store.get();
  return {
    licenseKey: cfg.licenseKey,
    licenseEmail: cfg.licenseEmail,
    licenseStatus: cfg.licenseStatus,
    hwid: getClientHwid(),
  };
});

ipcMain.handle("bromeo:report-session-event", async (_e, data: { eventType: string; durationSeconds: number }) => {
  try {
    const hwid = getClientHwid();
    const key = store.get().licenseKey || "";
    const mail = store.get().licenseEmail || "";

    await fetch("https://bromeoremote.com/api/session/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: key,
        email: mail,
        hwid,
        eventType: data.eventType || "remote_session",
        durationSeconds: data.durationSeconds,
        platform: process.platform,
        appVersion: app.getVersion(),
      }),
    });
    return true;
  } catch {
    return false;
  }
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

ipcMain.handle("bromeo:generate-totp-secret", async () => {
  pendingTotpSecret = generateSecret();
  const otpauthUri = buildOtpauthUri(pendingTotpSecret, store.get().deviceId);
  // Generated here (main process) rather than the renderer — the renderer
  // has no bundler/node_modules resolution for its ES module imports (see
  // tsconfig.renderer.json), so an npm package like `qrcode` can only run
  // in the main/Node context. Passed over IPC as a data: URL, same pattern
  // as any other main->renderer payload.
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });
  } catch {
    // Non-fatal — the renderer still shows the secret for manual entry.
  }
  return { secret: pendingTotpSecret, otpauthUri, qrDataUrl };
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

ipcMain.handle("bromeo:get-trusted-devices", () => store.getTrustedDevices());

ipcMain.handle("bromeo:remove-trusted-device", (_e, id: string) => {
  store.removeTrustedDevice(id);
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
ipcMain.handle("bromeo:hide-wallpaper", (_e, enabled: boolean) => (enabled ? hideWallpaper() : restoreWallpaper()));
ipcMain.handle("bromeo:get-cursor-shape", () => getCursorShape());

ipcMain.handle("bromeo:sas-status", () => isSasInstalled());
ipcMain.handle("bromeo:sas-install", () => installSas());
ipcMain.handle("bromeo:sas-uninstall", () => uninstallSas());
ipcMain.handle("bromeo:send-ctrl-alt-del", () => sendCtrlAltDel());

ipcMain.handle("bromeo:list-monitors", async (): Promise<MonitorInfo[]> => {
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
  return sources.map((s, i) => ({ id: s.id, label: s.name || `Scherm ${i + 1}` }));
});

let savedWindowBoundsList: { hwnd: number; bounds: { x: number; y: number; width: number; height: number } }[] = [];

function saveWindowBoundsForHwnd(hwnd: number) {
  if (!savedWindowBoundsList.some((item) => item.hwnd === hwnd)) {
    const bounds = getWindowBounds(hwnd);
    if (bounds) {
      savedWindowBoundsList.push({ hwnd, bounds });
    }
  }
}

function restoreSavedWindowBounds() {
  for (const item of savedWindowBoundsList) {
    resizeAndFocusWindow(item.hwnd, item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height);
  }
  savedWindowBoundsList = [];
}

ipcMain.handle("bromeo:set-active-monitor", (_e, monitorId: string) => {
  stopKeepForegroundLoop();
  restoreSavedWindowBounds();
  activeMonitorId = monitorId;
  activeWindowId = null;
  activeDualWindows = null;
  activeDualBounds = null;
  return true;
});

ipcMain.handle("bromeo:list-windows", async (): Promise<WindowInfo[]> => {
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 160, height: 160 } });
  return sources
    // Excludes all of this app's own windows, not just the main one —
    // mini.html's title is "BromeoRemote sessiebediening", not "BromeoRemote".
    // We match exactly to avoid hiding other apps like "BromeoRemote - Google Antigravity IDE".
    .filter((s) => s.name && s.name.trim() && s.name !== "BromeoRemote" && s.name !== "BromeoRemote sessiebediening")
    .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? undefined : s.thumbnail.toDataURL() }));
});

ipcMain.handle("bromeo:set-active-window", (_e, windowId: string, aspect: number) => {
  if (activeWindowId !== windowId) {
    restoreSavedWindowBounds();
    activeWindowId = windowId;
    activeDualWindows = null;
  activeDualBounds = null;
    const hwnd = hwndFromWindowSourceId(activeWindowId);
    if (hwnd != null) saveWindowBoundsForHwnd(hwnd);
  }
  startKeepForegroundLoop();
  return resizeActiveWindowToAspect(aspect);
});

ipcMain.handle("bromeo:resize-active-window", (_e, aspect: number) => resizeActiveWindowToAspect(aspect));

ipcMain.handle("bromeo:set-dual-window", (_e, windowId1: string, windowId2: string, aspect: number, isPortrait: boolean) => {
  restoreSavedWindowBounds();
  activeWindowId = null;
  activeDualWindows = { windowId1, windowId2 };
  const hwnd1 = hwndFromWindowSourceId(windowId1);
  const hwnd2 = hwndFromWindowSourceId(windowId2);
  if (hwnd1 != null) saveWindowBoundsForHwnd(hwnd1);
  if (hwnd2 != null) saveWindowBoundsForHwnd(hwnd2);
  startKeepForegroundLoop();
  return tileDualWindows(windowId1, windowId2, aspect, isPortrait);
});

ipcMain.handle("bromeo:resize-dual-window", (_e, aspect: number, isPortrait: boolean) => {
  if (!activeDualWindows) return false;
  return tileDualWindows(activeDualWindows.windowId1, activeDualWindows.windowId2, aspect, isPortrait);
});

ipcMain.handle("bromeo:set-capture-desktop", () => {
  stopKeepForegroundLoop();
  activeDualWindows = null;
  activeDualBounds = null;
  restoreSavedWindowBounds();
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

ipcMain.handle(
  "bromeo:check-password",
  (_e, passwordHash: string, totpCode?: string, fromId?: string, fromLabel?: string, trustDevice?: boolean) => {
    const cfg = store.get();
    if (passwordHash === hashPassword(sessionPassword)) return { ok: true, mode: "session" };
    if (cfg.unattendedEnabled && cfg.unattendedPasswordHash && passwordHash === cfg.unattendedPasswordHash) {
      if (cfg.totpEnabled && !(fromId && store.isDeviceTrusted(fromId))) {
        const secret = store.getTotpSecret();
        if (!totpCode) return { ok: false, reason: "totp-required" };
        if (!secret || !verifyTotp(secret, totpCode)) return { ok: false, reason: "bad-totp" };
        // Opted into per-device at the moment the code is verified — never
        // automatic, and only takes effect on this and future attempts, not
        // retroactively.
        if (trustDevice && fromId) store.trustDevice(fromId, fromLabel?.trim() || fromId);
      }
      return { ok: true, mode: "unattended" };
    }
    return { ok: false };
  }
);

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

// Chromium's "Secure DNS" (DNS-over-HTTPS) queries a hardcoded external
// resolver directly, bypassing the OS/router DNS resolver entirely — which
// silently breaks our LAN split-DNS override (turn.bromeoremote.com /
// remote.bromeoremote.com -> the LAN IP) whenever this app runs on the same
// network as the signaling/coturn server. Without this, it resolves the
// public IP instead and hairpins through the router, which is what was
// causing TURN allocate requests to intermittently fail/time out even
// though a plain STUN binding (simpler, more tolerant of the hairpin
// round-trip) usually still got through. Must be set before the app is ready.
app.commandLine.appendSwitch("disable-features", "DnsOverHttps");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // A second instance of BromeoRemote is being opened on this PC!
  // Assign a fresh, unique device ID so both instances can run simultaneously with distinct IDs.
  store.setSecondaryInstance();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  createWindow();
  startBridge(handleBridgeNotification);
  setupAutoUpdater();
});

app.on("before-quit", () => {
  // Safety net: never let the app exit with the physical display left off,
  // the local mouse/keyboard left blocked, or the wallpaper left hidden.
  setMonitorPower(true);
  setBlockInput(false);
  restoreWallpaper();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
