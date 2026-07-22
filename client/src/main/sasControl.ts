import { spawn } from "child_process";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";

const TASK_NAME = "BromeoRemoteSAS";

function sasHelperPath(): string {
  // sasHelper.js is compiled to the same dist/main/ directory as this file.
  return join(__dirname, "sasHelper.js");
}

function runPowerShell(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", ...args], { windowsHide: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", () => resolve(-1));
  });
}

// Runs a script file as Administrator via a UAC consent prompt. The caller
// (this Electron process) stays unprivileged the whole time — only the
// spawned child runs elevated, and only for the duration of that one script.
async function runElevated(scriptPath: string): Promise<boolean> {
  const code = await runPowerShell([
    "-Command",
    `Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}' -Verb RunAs -Wait`,
  ]);
  return code === 0;
}

async function withTempScript<T>(content: string, run: (scriptPath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bromeoremote-sas-"));
  const scriptPath = join(dir, "setup.ps1");
  try {
    await writeFile(scriptPath, content, "utf-8");
    return await run(scriptPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function isSasInstalled(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const code = await runPowerShell(["-Command", `schtasks /query /tn "${TASK_NAME}" | Out-Null; exit $LASTEXITCODE`]);
  return code === 0;
}

// Registers a SYSTEM-privileged, no-trigger Scheduled Task (only ever run
// on-demand via sendCtrlAltDel — never at startup/login) that launches
// sasHelper.ts, plus the SoftwareSASGeneration registry policy that lets a
// SYSTEM task actually broadcast a SAS. Both require admin, hence the UAC
// prompt — this is a one-time, explicit, user-triggered opt-in, never done
// silently by the app itself.
//
// Register-ScheduledTask's default ACL for a SYSTEM + RunLevel-Highest task
// only grants Administrators query/run rights — confirmed live: an
// unprivileged `schtasks /run` and `schtasks /query` both fail with "access
// denied" against a freshly registered task otherwise. The explicit
// SetSecurityDescriptor call below grants Authenticated Users (AU) read+
// execute, which is what lets isSasInstalled()'s plain query and
// sendCtrlAltDel()'s plain run both work without their own elevation.
export async function installSas(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const exePath = process.execPath;
  const helperPath = sasHelperPath();
  const cmdArg = `/c set ELECTRON_RUN_AS_NODE=1&&"${exePath}" "${helperPath}"`;
  const script = `
$ErrorActionPreference = "Stop"
New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name SoftwareSASGeneration -PropertyType DWord -Value 1 -Force | Out-Null
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '${cmdArg}'
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "${TASK_NAME}" -Action $action -Principal $principal -Force | Out-Null
$service = New-Object -ComObject "Schedule.Service"
$service.Connect()
$task = $service.GetFolder("\\").GetTask("${TASK_NAME}")
$task.SetSecurityDescriptor("D:(A;;GRGX;;;AU)(A;;FA;;;BA)(A;;FA;;;SY)", 0)
`;
  const ok = await withTempScript(script, runElevated);
  return ok && (await isSasInstalled());
}

export async function uninstallSas(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const script = `
Unregister-ScheduledTask -TaskName "${TASK_NAME}" -Confirm:$false -ErrorAction SilentlyContinue
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name SoftwareSASGeneration -Value 0 -ErrorAction SilentlyContinue
`;
  await withTempScript(script, runElevated);
  return !(await isSasInstalled());
}

// Starting an already-registered task does not itself require elevation —
// Task Scheduler runs it with the task's own configured principal (SYSTEM)
// regardless of our privilege level, *provided* the task's ACL grants us
// query/run rights, which installSas() sets up explicitly (it isn't the
// default). This call itself never prompts for UAC.
//
// Confirmed live on a real Windows 11 machine: the task registers and runs
// correctly end-to-end (exit code 0, no thrown errors) — but sas.dll's
// SendSAS produced no observable effect (the security screen never
// appeared). Root cause unconfirmed: possibly this API no longer works on
// current Windows builds, or its internal check specifically requires a
// real SCM service rather than a SYSTEM-principal Scheduled Task. Treat this
// feature as experimental until that's resolved.
export async function sendCtrlAltDel(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const code = await runPowerShell(["-Command", `schtasks /run /tn "${TASK_NAME}" | Out-Null; exit $LASTEXITCODE`]);
  return code === 0;
}
