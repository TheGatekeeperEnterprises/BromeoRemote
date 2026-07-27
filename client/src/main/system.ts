import { exec, execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import koffi from "koffi";
import type { CursorShapeName } from "../shared/protocol.js";

// Only verified on Windows (this project's tested platform so far) — the
// macOS/Linux branches are best-effort and may need a privilege prompt that
// isn't handled here.
export function restartComputer(delaySeconds = 10): void {
  if (process.platform === "win32") {
    exec(`shutdown /r /t ${delaySeconds} /c "Herstart aangevraagd via BromeoRemote"`);
  } else if (process.platform === "darwin") {
    exec("osascript -e 'tell app \"System Events\" to restart'");
  } else {
    exec("shutdown -r now");
  }
}

// Locks the session immediately (no delay/confirmation like restart — it's
// non-destructive and instantly reversible with the host's own credentials).
// Same cross-platform confidence caveat as restartComputer: only verified on
// Windows.
export function lockComputer(): void {
  if (process.platform === "win32") {
    exec("rundll32.exe user32.dll,LockWorkStation");
  } else if (process.platform === "darwin") {
    exec('"/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession" -suspend');
  } else {
    exec("loginctl lock-session || xdg-screensaver lock");
  }
}

// Win32 BlockInput() — disables the host's own local mouse/keyboard while a
// viewer is in control, via koffi (no native addon / node-gyp build step
// needed). Windows-only; unsupported elsewhere. The OS itself force-releases
// the block if this process exits, but that's only a last-resort safety
// net — callers must still release it explicitly when a session ends
// normally (see the `inputBlocked` handling around endSession() in app.ts).
let blockInputFn: ((block: boolean) => number) | null = null;
export function setBlockInput(block: boolean): boolean {
  if (process.platform !== "win32") return false;
  try {
    if (!blockInputFn) {
      const user32 = koffi.load("user32.dll");
      blockInputFn = user32.func("bool BlockInput(bool fBlockIt)") as (block: boolean) => number;
    }
    return !!blockInputFn(block);
  } catch {
    return false;
  }
}

// Used by the "control a program" mobile feature: resizes+focuses a specific
// window (by HWND) to fill a target rectangle, so it can be sized to match
// the viewer's phone aspect ratio (portrait/landscape) with minimal
// letterboxing. Windows-only.
let windowPosFns: {
  showWindow: (hwnd: bigint, cmd: number) => number;
  setWindowPos: (hwnd: bigint, insertAfter: bigint, x: number, y: number, cx: number, cy: number, flags: number) => number;
  setForegroundWindow: (hwnd: bigint) => number;
} | null = null;
const SW_RESTORE = 9;
const SWP_SHOWWINDOW = 0x0040;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const HWND_TOP = 0n;
export function resizeAndFocusWindow(hwnd: number, x: number, y: number, width: number, height: number): boolean {
  if (process.platform !== "win32") return false;
  try {
    if (!windowPosFns) {
      const user32 = koffi.load("user32.dll");
      windowPosFns = {
        showWindow: user32.func("bool ShowWindow(void* hWnd, int nCmdShow)") as (hwnd: bigint, cmd: number) => number,
        setWindowPos: user32.func("bool SetWindowPos(void* hWnd, void* hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)") as (
          hwnd: bigint,
          insertAfter: bigint,
          x: number,
          y: number,
          cx: number,
          cy: number,
          flags: number
        ) => number,
        setForegroundWindow: user32.func("bool SetForegroundWindow(void* hWnd)") as (hwnd: bigint) => number,
      };
    }
    // koffi represents pointers as BigInt — hwnd arrives as a plain number
    // (parsed from desktopCapturer's window source id), so convert rather
    // than rely on any implicit coercion.
    const hwndPtr = BigInt(hwnd);
    // Un-maximize first — SetWindowPos on a still-maximized window won't
    // visually resize it.
    windowPosFns.showWindow(hwndPtr, SW_RESTORE);
    windowPosFns.setWindowPos(hwndPtr, HWND_TOP, x, y, width, height, SWP_SHOWWINDOW);
    windowPosFns.setForegroundWindow(hwndPtr);
    return true;
  } catch {
    return false;
  }
}

// Re-asserts z-order/focus only — no resize, no un-maximize — so a periodic
// "keep these windows on top" loop (see main.ts's keepForegroundLoop) can
// call this often without fighting a window's current size/state, just its
// stacking order. Split out from resizeAndFocusWindow (which does a real
// SW_RESTORE + reposition, appropriate only for the one-time initial
// switch/rotation, not for a tight repeat loop).
export function bringWindowToFront(hwnd: number): boolean {
  if (process.platform !== "win32" || !windowPosFns) return false;
  try {
    const hwndPtr = BigInt(hwnd);
    windowPosFns.setWindowPos(hwndPtr, HWND_TOP, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE);
    windowPosFns.setForegroundWindow(hwndPtr);
    return true;
  } catch {
    return false;
  }
}

let windowBoundsFn: ((hwnd: bigint, rect: Record<string, unknown>) => number) | null = null;
export function getWindowBounds(hwnd: number): { x: number; y: number; width: number; height: number } | null {
  if (process.platform !== "win32") return null;
  try {
    if (!windowBoundsFn) {
      const user32 = koffi.load("user32.dll");
      const RECT = koffi.struct("RECT", { left: "int", top: "int", right: "int", bottom: "int" });
      windowBoundsFn = user32.func("bool GetWindowRect(void* hWnd, _Out_ RECT *lpRect)") as any;
    }
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (windowBoundsFn!(BigInt(hwnd), rect)) {
      return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
    }
  } catch {}
  return null;
}

// Hides just the desktop wallpaper *image* (SPI_SETDESKWALLPAPER with an
// empty path shows the plain background color instead) — distinct from
// curtain mode, which blanks the whole local screen. Windows-only. The
// Add-Type/P-Invoke block is written to a temp .ps1 and run with -File
// rather than inlined via -Command, since escaping a multi-line C# snippet
// through both this string and a shell would be far more fragile.
let savedWallpaperPath: string | null = null;
const SET_WALLPAPER_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BromeoWallpaper {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[BromeoWallpaper]::SystemParametersInfo(20, 0, $args[0], 3) | Out-Null
`;

function runSetWallpaperScript(path: string): void {
  const scriptPath = join(tmpdir(), "bromeoremote-set-wallpaper.ps1");
  writeFileSync(scriptPath, SET_WALLPAPER_SCRIPT, "utf8");
  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" "${path}"`);
}

export function hideWallpaper(): boolean {
  if (process.platform !== "win32") return false;
  try {
    if (savedWallpaperPath == null) {
      savedWallpaperPath = execSync(
        `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper).Wallpaper"`,
        { encoding: "utf8" }
      ).trim();
    }
    runSetWallpaperScript(""); // empty path -> plain background color, no image
    return true;
  } catch {
    return false;
  }
}

export function restoreWallpaper(): boolean {
  if (process.platform !== "win32" || savedWallpaperPath == null) return false;
  try {
    runSetWallpaperScript(savedWallpaperPath);
    savedWallpaperPath = null;
    return true;
  } catch {
    return false;
  }
}

// Detects which standard system cursor is currently showing, by comparing
// GetCursorInfo's active cursor handle against LoadCursor(NULL, IDC_*)'s
// known handles for each standard shape — Windows doesn't expose "what
// shape is this" any more directly than "does this handle equal that
// handle." A custom/app-drawn cursor (a handful of games/creative tools
// use these) won't match any of these and falls back to "arrow" — fine for
// a remote-support tool, where the standard OS/browser/UI cursors are what
// actually matters. Windows-only.
//
// koffi footgun worth documenting: GetCursorInfo needs the struct pointer
// declared `_Inout_`, not plain or `_Out_` — `_Out_` silently zeroes the
// `cbSize` field koffi is supposed to send *in* (the API requires it be
// pre-set to sizeof(CURSORINFO) to validate the call), which makes the
// call fail with ERROR_INVALID_PARAMETER; plain (no annotation) does
// succeed but koffi never copies the result fields back into the JS
// object. Verified against a real GetLastError()/manual poll before
// wiring this in — see docs history/commit for that throwaway test.
let cursorFns: {
  getCursorInfo: (info: Record<string, unknown>) => number;
  loadCursor: (hInstance: number, id: number) => bigint;
  cursorInfoSize: number;
} | null = null;
let systemCursorHandles: Partial<Record<CursorShapeName, bigint>> | null = null;

// Win32 IDC_* resource IDs (winuser.h) — passed to LoadCursor via the
// MAKEINTRESOURCE convention (a small integer used directly as the
// "pointer" argument, not a real string).
const IDC: Partial<Record<CursorShapeName, number>> = {
  arrow: 32512,
  text: 32513,
  wait: 32514,
  "resize-nwse": 32642,
  "resize-nesw": 32643,
  "resize-ew": 32644,
  "resize-ns": 32645,
  move: 32646,
  "not-allowed": 32648,
  hand: 32649,
  help: 32651,
};

function ensureCursorFns(): void {
  if (cursorFns) return;
  const user32 = koffi.load("user32.dll");
  const CURSORINFO = koffi.struct("CURSORINFO", {
    cbSize: "uint32",
    flags: "uint32",
    hCursor: "void*",
    ptX: "int32",
    ptY: "int32",
  });
  cursorFns = {
    getCursorInfo: user32.func("bool GetCursorInfo(_Inout_ CURSORINFO *pci)") as (info: Record<string, unknown>) => number,
    loadCursor: user32.func("void* LoadCursorW(void* hInstance, uintptr lpCursorName)") as (hInstance: number, id: number) => bigint,
    cursorInfoSize: koffi.sizeof(CURSORINFO),
  };
  const handles: Partial<Record<CursorShapeName, bigint>> = {};
  for (const [shape, id] of Object.entries(IDC)) {
    handles[shape as CursorShapeName] = cursorFns.loadCursor(0, id);
  }
  systemCursorHandles = handles;
}

export function getCursorShape(): CursorShapeName {
  if (process.platform !== "win32") return "arrow";
  try {
    ensureCursorFns();
    if (!cursorFns || !systemCursorHandles) return "arrow";
    const info = { cbSize: cursorFns.cursorInfoSize, flags: 0, hCursor: null, ptX: 0, ptY: 0 };
    if (!cursorFns.getCursorInfo(info)) return "arrow";
    const hCursor = info.hCursor as bigint | null;
    const match = Object.entries(systemCursorHandles).find(([, h]) => h === hCursor);
    return (match?.[0] as CursorShapeName) ?? "arrow";
  } catch {
    return "arrow";
  }
}
