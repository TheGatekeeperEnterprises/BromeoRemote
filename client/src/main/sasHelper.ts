// Standalone entry point — launched by the SYSTEM-level Scheduled Task that
// installSas() registers (see sasControl.ts), NOT part of the normal
// Electron app boot path. The task runs this with ELECTRON_RUN_AS_NODE=1 set
// so the packaged BromeoRemote.exe behaves as plain Node (no Chromium/GPU
// init). It does one thing and exits immediately — there is no persistent
// process to manage, so "uninstalling" this feature is just removing the
// scheduled task, nothing here needs its own shutdown path.
import koffi from "koffi";

function main(): void {
  if (process.platform !== "win32") process.exit(1);
  try {
    const sas = koffi.load("sas.dll");
    const SendSAS = sas.func("void SendSAS(bool AsUser)");
    // AsUser=false: we're the SYSTEM task, not the interactive user — this is
    // exactly the case the "services" bit of SoftwareSASGeneration exists
    // for, broadcasting the SAS to the currently active console session.
    //
    // Confirmed live: this call returns without throwing, but the Ctrl+Alt+
    // Del screen doesn't actually appear on a real Windows 11 machine — see
    // sendCtrlAltDel()'s comment in sasControl.ts for what's still unknown.
    SendSAS(false);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

main();
