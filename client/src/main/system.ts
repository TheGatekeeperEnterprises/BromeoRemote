import { exec, execSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import koffi from "koffi";

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
