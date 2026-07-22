import { execFile } from "child_process";

// Windows-only: broadcasts WM_SYSCOMMAND/SC_MONITORPOWER, which puts the
// physical display to sleep (or wakes it) without affecting the desktop
// buffer itself — screen capture keeps working normally while the monitor
// is dark. This is a privacy screen (hides the desktop from a bystander at
// the physical machine), NOT an input lock: moving the local mouse or
// pressing a key wakes the display again, same as normal Windows behavior.
export function setMonitorPower(on: boolean): void {
  if (process.platform !== "win32") return;
  const lParam = on ? -1 : 2;
  const script = [
    "Add-Type -TypeDefinition '" +
      'using System; using System.Runtime.InteropServices; ' +
      'public class BromeoDisp { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l); }' +
      "';",
    `[BromeoDisp]::SendMessage([IntPtr]0xffff, 0x112, [IntPtr]0xF170, [IntPtr]${lParam}) | Out-Null`,
  ].join(" ");
  execFile("powershell.exe", ["-NoProfile", "-Command", script]);
}
