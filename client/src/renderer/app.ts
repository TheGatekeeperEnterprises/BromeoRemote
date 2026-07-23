import { DEFAULT_SIGNALING_URL, DEFAULT_ICE_SERVERS } from "../shared/config.js";
import type { ServerMessage } from "../shared/protocol.js";
import type { InputEvent, MonitorInfo, NotificationPayload, QualityLevel, SavedDevice, SessionPermissions, UpdateStatus } from "../shared/protocol.js";
import type { MiniControllerState } from "./global";
import { sha256Hex } from "./crypto.js";
import { Signaling } from "./signaling.js";
import { PeerSession, type Role } from "./session.js";

interface NotifyHistoryEntry extends NotificationPayload {
  origin: "local" | "remote";
  replyTo?: string;
  status?: "allow" | "deny";
}

interface SessionHistoryEntry {
  id: string;
  peerId: string;
  role: Role;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  viewOnly: boolean;
  permissions?: SessionPermissions;
  filesTransferred: number;
  note: string;
  recorded?: boolean;
}

// "auto" (null) leaves WebRTC's own congestion control uncapped — high/low
// are hard ceilings for constrained connections, not floors.
const QUALITY_BITRATE_KBPS: Record<QualityLevel, number | null> = { auto: null, high: 8000, low: 800 };
// No resolution cap — capture native. Now that the mobile viewer's zoomed
// render actually uses the real decoded detail instead of stretching a
// smaller frame (see App.tsx's RTCView layout-size fix), and pinch-zoom has
// no upper bound either, native resolution is what makes deep zoom actually
// reveal more real detail instead of hitting a resolution ceiling.
const CAPTURE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: 30,
};
const SESSION_HISTORY_KEY = "bromeo:session-history";
const IDLE_TIMEOUT_KEY = "bromeo:idle-timeout-minutes";
const RECORDING_MODE_KEY = "bromeo:recording-mode";
const TRUSTED_ONLY_KEY = "bromeo:trusted-only-connections";
const IDLE_TIMEOUT_OPTIONS = [0, 5, 15, 30, 60] as const;
type IdleTimeoutMinutes = (typeof IDLE_TIMEOUT_OPTIONS)[number];
type RecordingMode = "manual" | "auto";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  myId: $<HTMLSpanElement>("my-id"),
  myPassword: $<HTMLSpanElement>("my-password"),
  overviewLabel: $<HTMLSpanElement>("overview-label"),
  overviewId: $<HTMLSpanElement>("overview-id"),
  overviewPassword: $<HTMLSpanElement>("overview-password"),
  deviceLabel: $<HTMLInputElement>("device-label"),
  deviceLabelSave: $<HTMLButtonElement>("device-label-save"),
  copyId: $<HTMLButtonElement>("copy-id"),
  copyPassword: $<HTMLButtonElement>("copy-password"),
  copyInvite: $<HTMLButtonElement>("copy-invite"),
  regeneratePassword: $<HTMLButtonElement>("regenerate-password"),
  unattendedToggle: $<HTMLInputElement>("unattended-toggle"),
  unattendedForm: $<HTMLDivElement>("unattended-form"),
  unattendedPassword: $<HTMLInputElement>("unattended-password"),
  unattendedSave: $<HTMLButtonElement>("unattended-save"),
  unattendedStrength: $<HTMLDivElement>("unattended-strength"),
  curtainToggle: $<HTMLInputElement>("curtain-toggle"),
  curtainManualToggle: $<HTMLButtonElement>("curtain-manual-toggle"),
  trustedOnlyToggle: $<HTMLInputElement>("trusted-only-toggle"),
  totpDisabledState: $<HTMLDivElement>("totp-disabled-state"),
  totpStartSetup: $<HTMLButtonElement>("totp-start-setup"),
  totpSetup: $<HTMLDivElement>("totp-setup"),
  totpSecret: $<HTMLSpanElement>("totp-secret"),
  totpCopy: $<HTMLButtonElement>("totp-copy"),
  totpVerifyCode: $<HTMLInputElement>("totp-verify-code"),
  totpConfirm: $<HTMLButtonElement>("totp-confirm"),
  totpEnabledState: $<HTMLDivElement>("totp-enabled-state"),
  totpDisable: $<HTMLButtonElement>("totp-disable"),
  totpRequiredModal: $<HTMLDivElement>("totp-required-modal"),
  totpRequiredMessage: $<HTMLElement>("totp-required-message"),
  totpRequiredInput: $<HTMLInputElement>("totp-required-input"),
  totpRequiredSubmit: $<HTMLButtonElement>("totp-required-submit"),
  totpRequiredCancel: $<HTMLButtonElement>("totp-required-cancel"),
  targetId: $<HTMLInputElement>("target-id"),
  targetPassword: $<HTMLInputElement>("target-password"),
  connectBtn: $<HTMLButtonElement>("connect-btn"),
  connectStatus: $<HTMLParagraphElement>("connect-status"),
  savedDevicesFilter: $<HTMLInputElement>("saved-devices-filter"),
  savedDevicesList: $<HTMLDivElement>("saved-devices-list"),
  sessionHistoryList: $<HTMLDivElement>("session-history-list"),
  clearSessionHistory: $<HTMLButtonElement>("clear-session-history"),
  rememberDevice: $<HTMLInputElement>("remember-device"),
  rememberLabel: $<HTMLInputElement>("remember-label"),
  rememberGroup: $<HTMLInputElement>("remember-group"),
  rememberMac: $<HTMLInputElement>("remember-mac"),
  viewOnlyToggle: $<HTMLInputElement>("view-only-toggle"),
  permissionControl: $<HTMLInputElement>("permission-control"),
  permissionClipboard: $<HTMLInputElement>("permission-clipboard"),
  permissionFiles: $<HTMLInputElement>("permission-files"),
  viewOnlyBadge: $<HTMLSpanElement>("viewonly-badge"),
  themeToggle: $<HTMLButtonElement>("theme-toggle"),
  serverStatus: $<HTMLSpanElement>("server-status"),
  serverStatusText: $<HTMLSpanElement>("server-status-text"),
  home: $<HTMLElement>("home"),
  sharingBar: $<HTMLDivElement>("sharing-bar"),
  sharingText: $<HTMLSpanElement>("sharing-text"),
  sharingEnd: $<HTMLButtonElement>("sharing-end"),
  sharingPanic: $<HTMLButtonElement>("sharing-panic"),
  hostClipboardBtn: $<HTMLButtonElement>("host-clipboard-sync-btn"),
  incomingModal: $<HTMLDivElement>("incoming-modal"),
  incomingFrom: $<HTMLElement>("incoming-from"),
  incomingAction: $<HTMLElement>("incoming-action"),
  incomingTimeout: $<HTMLElement>("incoming-timeout"),
  incomingAccept: $<HTMLButtonElement>("incoming-accept"),
  incomingDecline: $<HTMLButtonElement>("incoming-decline"),
  sessionView: $<HTMLDivElement>("session-view"),
  sessionPeer: $<HTMLSpanElement>("session-peer"),
  sessionState: $<HTMLSpanElement>("session-state"),
  sessionStats: $<HTMLSpanElement>("session-stats"),
  sessionDuration: $<HTMLSpanElement>("session-duration"),
  remoteVideo: $<HTMLVideoElement>("remote-video"),
  videoWrap: document.querySelector<HTMLDivElement>(".video-wrap")!,
  fitModeSelect: $<HTMLSelectElement>("fit-mode-select"),
  qualitySelect: $<HTMLSelectElement>("quality-select"),
  idleTimeoutSelect: $<HTMLSelectElement>("idle-timeout-select"),
  recordingModeSelect: $<HTMLSelectElement>("recording-mode-select"),
  sessionHint: $<HTMLDivElement>("session-hint"),
  audioToggleBtn: $<HTMLButtonElement>("audio-toggle-btn"),
  clipboardBtn: $<HTMLButtonElement>("clipboard-sync-btn"),
  textToggleBtn: $<HTMLButtonElement>("text-toggle-btn"),
  textPanel: $<HTMLDivElement>("text-panel"),
  remoteTextInput: $<HTMLTextAreaElement>("remote-text-input"),
  remoteTextSendBtn: $<HTMLButtonElement>("remote-text-send-btn"),
  remoteTextClearBtn: $<HTMLButtonElement>("remote-text-clear-btn"),
  shortcutsToggleBtn: $<HTMLButtonElement>("shortcuts-toggle-btn"),
  shortcutsPanel: $<HTMLDivElement>("shortcuts-panel"),
  notesToggleBtn: $<HTMLButtonElement>("notes-toggle-btn"),
  notesPanel: $<HTMLDivElement>("notes-panel"),
  sessionNotesInput: $<HTMLTextAreaElement>("session-notes-input"),
  recordToggleBtn: $<HTMLButtonElement>("record-toggle-btn"),
  recordingIndicator: $<HTMLSpanElement>("recording-indicator"),
  recordingTime: $<HTMLSpanElement>("recording-time"),
  filesToggleBtn: $<HTMLButtonElement>("files-toggle-btn"),
  filesPanel: $<HTMLDivElement>("files-panel"),
  filesList: $<HTMLDivElement>("files-list"),
  sendFileBtn: $<HTMLButtonElement>("send-file-btn"),
  fullscreenBtn: $<HTMLButtonElement>("fullscreen-btn"),
  disconnectBtn: $<HTMLButtonElement>("session-disconnect-btn"),
  restartBtn: $<HTMLButtonElement>("restart-btn"),
  lockBtn: $<HTMLButtonElement>("lock-btn"),
  lockOnEndBtn: $<HTMLButtonElement>("lock-on-end-btn"),
  blockInputBtn: $<HTMLButtonElement>("block-input-btn"),
  ctrlAltDelBtn: $<HTMLButtonElement>("ctrl-alt-del-btn"),
  sasDisabledState: $<HTMLDivElement>("sas-disabled-state"),
  sasInstallBtn: $<HTMLButtonElement>("sas-install-btn"),
  sasEnabledState: $<HTMLDivElement>("sas-enabled-state"),
  sasUninstallBtn: $<HTMLButtonElement>("sas-uninstall-btn"),
  restartConfirmModal: $<HTMLDivElement>("restart-confirm-modal"),
  restartTarget: $<HTMLElement>("restart-target"),
  restartConfirmBtn: $<HTMLButtonElement>("restart-confirm"),
  restartCancelBtn: $<HTMLButtonElement>("restart-cancel"),
  monitorSelect: $<HTMLSelectElement>("monitor-select"),
  chatToggleBtn: $<HTMLButtonElement>("chat-toggle-btn"),
  chatPanel: $<HTMLDivElement>("chat-panel"),
  chatMessages: $<HTMLDivElement>("chat-messages"),
  chatInput: $<HTMLInputElement>("chat-input"),
  chatSendBtn: $<HTMLButtonElement>("chat-send-btn"),
  hostChatToggleBtn: $<HTMLButtonElement>("host-chat-toggle-btn"),
  hostChatPanel: $<HTMLDivElement>("host-chat-panel"),
  hostChatMessages: $<HTMLDivElement>("host-chat-messages"),
  hostChatInput: $<HTMLInputElement>("host-chat-input"),
  hostChatSendBtn: $<HTMLButtonElement>("host-chat-send-btn"),
  aiBuddyToggleBtn: $<HTMLButtonElement>("ai-buddy-toggle-btn"),
  aiBuddyPanel: $<HTMLDivElement>("ai-buddy-panel"),
  aiBuddyStatus: $<HTMLSpanElement>("ai-buddy-status"),
  aiBuddyMessages: $<HTMLDivElement>("ai-buddy-messages"),
  aiBuddyScreenshotPreview: $<HTMLDivElement>("ai-buddy-screenshot-preview"),
  aiBuddyScreenshotImg: $<HTMLImageElement>("ai-buddy-screenshot-img"),
  aiBuddyScreenshotRemove: $<HTMLButtonElement>("ai-buddy-screenshot-remove"),
  aiBuddyScreenshotBtn: $<HTMLButtonElement>("ai-buddy-screenshot-btn"),
  aiBuddyInput: $<HTMLInputElement>("ai-buddy-input"),
  aiBuddySendBtn: $<HTMLButtonElement>("ai-buddy-send-btn"),
  aiBuddyCaptureCanvas: $<HTMLCanvasElement>("ai-buddy-capture-canvas"),
  openaiKeyInput: $<HTMLInputElement>("openai-key-input"),
  openaiKeySave: $<HTMLButtonElement>("openai-key-save"),
  openaiKeyStatus: $<HTMLParagraphElement>("openai-key-status"),
  toast: $<HTMLDivElement>("toast"),
  notifyForwardId: $<HTMLInputElement>("notify-forward-id"),
  notifyForwardSave: $<HTMLButtonElement>("notify-forward-save"),
  notifyBellBtn: $<HTMLButtonElement>("notify-bell-btn"),
  notifyBadge: $<HTMLSpanElement>("notify-badge"),
  notifyPanel: $<HTMLDivElement>("notify-panel"),
  notifyList: $<HTMLDivElement>("notify-list"),
  notifyClearBtn: $<HTMLButtonElement>("notify-clear-btn"),
  bridgeConfirmModal: $<HTMLDivElement>("bridge-confirm-modal"),
  bridgeConfirmTitle: $<HTMLElement>("bridge-confirm-title"),
  bridgeConfirmSource: $<HTMLElement>("bridge-confirm-source"),
  bridgeConfirmMessage: $<HTMLElement>("bridge-confirm-message"),
  bridgeConfirmRisk: $<HTMLSpanElement>("bridge-confirm-risk"),
  bridgeConfirmCommand: $<HTMLPreElement>("bridge-confirm-command"),
  bridgeConfirmAllow: $<HTMLButtonElement>("bridge-confirm-allow"),
  bridgeConfirmDeny: $<HTMLButtonElement>("bridge-confirm-deny"),
  bridgeConfirmView: $<HTMLButtonElement>("bridge-confirm-view"),
  appVersion: $<HTMLSpanElement>("app-version"),
  checkUpdatesBtn: $<HTMLButtonElement>("check-updates-btn"),
  updateStatusText: $<HTMLSpanElement>("update-status-text"),
  installUpdateBtn: $<HTMLButtonElement>("install-update-btn"),
};

let myId = "";
let signaling: Signaling;
let currentSession: PeerSession | null = null;
let currentRole: Role | null = null;
let deviceLabel = "";
let pendingIncoming: { fromId: string; viewOnly: boolean; permissions: SessionPermissions } | null = null;
let incomingTimerHandle: ReturnType<typeof setInterval> | null = null;
let incomingExpiresAt = 0;
let sessionViewOnly = false;
let notifyForwardId: string | null = null;
let notifyHistory: NotifyHistoryEntry[] = [];
let confirmQueue: NotifyHistoryEntry[] = [];
let activeConfirm: NotifyHistoryEntry | null = null;
let unseenNotifyCount = 0;
let savedDevices: SavedDevice[] = [];
let lastConnectAttempt: { targetId: string; passwordHash: string; viewOnly: boolean; permissions: SessionPermissions } | null = null;
// Gates auto-reconnect to sessions that actually connected at least once —
// an initial connection attempt that never got off the ground (bad
// password, offline target, ...) shouldn't trigger a retry loop.
let sessionReachedConnectedOnce = false;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recordingTimerHandle: ReturnType<typeof setInterval> | null = null;
let recordingStartedAt = 0;
let sessionStartedAt: number | null = null;
let sessionDurationHandle: ReturnType<typeof setInterval> | null = null;
let filesTransferredCount = 0;
let chatLog: { text: string; timestamp: number; mine: boolean }[] = [];
let aiBuddyLog: { role: "user" | "assistant"; text: string; imageBase64?: string; timestamp: number }[] = [];
let aiBuddyPendingScreenshot: string | null = null;
let aiBuddySending = false;
let restartRequestedFor: string | null = null;
let curtainModeEnabled = false;
let monitorIsOff = false;
let inputBlocked = false;
let lockOnSessionEnd = false;
let trustedOnlyConnections = false;
let currentPeerId: string | null = null;
let sessionPermissions: SessionPermissions = defaultPermissions(false);
let remoteAudioMuted = false;
let idleTimeoutMinutes: IdleTimeoutMinutes = 0;
let idleTimerHandle: ReturnType<typeof setInterval> | null = null;
let lastSessionActivityAt = 0;
let recordingMode: RecordingMode = "manual";
let sessionWasRecorded = false;
type RemoteFitMode = "fit" | "actual" | "stretch";

function toast(msg: string): void {
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  setTimeout(() => el.toast.classList.add("hidden"), 3200);
}

function setIconButtonState(button: HTMLButtonElement, label: string, iconId?: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
  const srLabel = button.querySelector<HTMLElement>(".sr-only");
  if (srLabel) srLabel.textContent = label;
  const visibleLabel = button.querySelector<HTMLElement>(".toolbar-visible-label");
  if (visibleLabel) visibleLabel.textContent = label;
  const use = button.querySelector<SVGUseElement>("use");
  if (use && iconId) use.setAttribute("href", `#${iconId}`);
}

async function init(): Promise<void> {
  const cfg = await window.bromeo.getConfig();
  myId = cfg.deviceId;
  deviceLabel = cfg.deviceLabel || "Dit apparaat";
  el.deviceLabel.value = deviceLabel;
  el.overviewLabel.textContent = deviceLabel;
  el.myId.textContent = formatId(cfg.deviceId);
  updateSessionPassword(cfg.sessionPassword);
  el.overviewId.textContent = formatId(cfg.deviceId);
  el.unattendedToggle.checked = cfg.unattendedEnabled;
  el.unattendedForm.classList.toggle("hidden", !cfg.unattendedEnabled);
  document.documentElement.setAttribute("data-theme", cfg.theme);
  updateThemeIcon(cfg.theme);
  applyRemoteFitMode((localStorage.getItem("bromeo:remote-fit-mode") as RemoteFitMode | null) ?? "fit");
  applyQualityLevel((localStorage.getItem("bromeo:quality-level") as QualityLevel | null) ?? "auto", false);
  applyIdleTimeout(localStorage.getItem(IDLE_TIMEOUT_KEY) ?? "0", false);
  applyRecordingMode(localStorage.getItem(RECORDING_MODE_KEY), false);
  notifyForwardId = cfg.notifyForwardId;
  el.notifyForwardId.value = notifyForwardId ?? "";
  trustedOnlyConnections = localStorage.getItem(TRUSTED_ONLY_KEY) === "1";
  el.trustedOnlyToggle.checked = trustedOnlyConnections;
  window.bromeo.getOpenAiKeyStatus().then((hasKey) => {
    el.openaiKeyStatus.textContent = hasKey ? "Sleutel ingesteld en versleuteld opgeslagen." : "Nog geen sleutel ingesteld.";
  });

  savedDevices = await window.bromeo.getSavedDevices();
  renderSavedDevices();
  renderSessionHistory();
  curtainModeEnabled = cfg.curtainModeEnabled;
  el.curtainToggle.checked = curtainModeEnabled;
  setTotpUiState(cfg.totpEnabled);
  window.bromeo.sasStatus().then(setSasUiState);

  signaling = new Signaling(DEFAULT_SIGNALING_URL);
  signaling.onMessage(onServerMessage);
  // "hello" re-registers this device's ID with the server's registry — must
  // fire on every reconnect (Signaling now retries automatically after a
  // dropped connection), not just the first one, or this PC would sit there
  // showing "Verbonden met server" but be unreachable by ID after any blip
  // (e.g. the signaling server restarting).
  signaling.onStatus((status) => {
    setServerStatus(status);
    if (status === "connected") signaling.send({ type: "hello", id: myId });
  });
  try {
    await signaling.connect();
  } catch {
    setServerStatus("disconnected");
    toast("Kan geen verbinding maken met de BromeoRemote-server. Controleer je netwerk of serverinstellingen.");
  }

  window.bromeo.onBridgeNotification(handleBridgeNotification);

  el.appVersion.textContent = await window.bromeo.getAppVersion();
  window.bromeo.onUpdateStatus(handleUpdateStatus);
  window.bromeo.checkForUpdates(); // safe to call now — listener above is already registered

  wireUi();
}

function handleUpdateStatus(status: UpdateStatus): void {
  const messages: Record<UpdateStatus["status"], string> = {
    checking: "Controleren op updates…",
    available: `Update gevonden (v${status.version}) — wordt gedownload…`,
    "not-available": "Je gebruikt de nieuwste versie.",
    downloading: `Downloaden… ${status.percent ?? 0}%`,
    downloaded: `Update v${status.version} gedownload — klaar om te installeren.`,
    error: `Kon niet controleren op updates: ${status.error ?? "onbekende fout"}`,
  };
  el.updateStatusText.textContent = messages[status.status];
  el.installUpdateBtn.classList.toggle("hidden", status.status !== "downloaded");
}

function updateThemeIcon(theme: "dark" | "light"): void {
  el.themeToggle.textContent = theme === "light" ? "☾" : "☀";
  el.themeToggle.title = theme === "light" ? "Donkere modus" : "Lichte modus";
}

function setServerStatus(status: "connected" | "disconnected"): void {
  el.serverStatus.classList.toggle("status-pill--online", status === "connected");
  el.serverStatus.classList.toggle("status-pill--offline", status === "disconnected");
  el.serverStatus.classList.remove("status-pill--pending");
  el.serverStatusText.textContent = status === "connected" ? "Verbonden met server" : "Niet verbonden";
}

function formatId(id: string): string {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

function formatIdInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

function defaultPermissions(viewOnly: boolean): SessionPermissions {
  return { control: !viewOnly, clipboard: true, files: true };
}

function normalizePermissions(permissions: Partial<SessionPermissions> | null | undefined, viewOnly: boolean): SessionPermissions {
  const fallback = defaultPermissions(viewOnly);
  return {
    control: viewOnly ? false : permissions?.control ?? fallback.control,
    clipboard: permissions?.clipboard ?? fallback.clipboard,
    files: permissions?.files ?? fallback.files,
  };
}

function permissionsFromUi(): SessionPermissions {
  return normalizePermissions(
    {
      control: el.permissionControl.checked,
      clipboard: el.permissionClipboard.checked,
      files: el.permissionFiles.checked,
    },
    el.viewOnlyToggle.checked
  );
}

function syncPermissionControlUi(): void {
  if (el.viewOnlyToggle.checked) {
    el.permissionControl.checked = false;
    el.permissionControl.disabled = true;
    return;
  }
  el.permissionControl.disabled = false;
  if (!el.permissionControl.checked) el.permissionControl.checked = true;
}

function permissionsSummary(permissions: SessionPermissions): string {
  const parts = [permissions.control ? "besturing" : "alleen kijken"];
  if (permissions.clipboard) parts.push("klembord");
  if (permissions.files) parts.push("bestanden");
  return parts.join(", ");
}

function permissionBadges(permissions: SessionPermissions): string {
  return [
    !permissions.control ? '<span class="badge-tag">Alleen kijken</span>' : "",
    !permissions.clipboard ? '<span class="badge-tag">Geen klembord</span>' : "",
    !permissions.files ? '<span class="badge-tag">Geen bestanden</span>' : "",
  ].join("");
}

async function copyWithFeedback(text: string, button: HTMLButtonElement, message: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const label = button.textContent ?? "";
  button.textContent = "Gekopieerd";
  button.disabled = true;
  toast(message);
  setTimeout(() => {
    button.textContent = label;
    button.disabled = false;
  }, 1200);
}

function updateSessionPassword(password: string): void {
  el.myPassword.textContent = password;
  el.overviewPassword.textContent = password;
}

function buildInviteText(): string {
  const password = el.myPassword.textContent ?? "";
  return [
    "BromeoRemote - verbinding op afstand",
    `Apparaatnaam: ${deviceLabel}`,
    `BromeoRemote-ID: ${formatId(myId)}`,
    `Sessiewachtwoord: ${password}`,
    "",
    "Open BromeoRemote, vul dit ID en wachtwoord in bij 'Verbinden met een ander apparaat' en klik op Verbinden.",
  ].join("\n");
}

async function regenerateSessionPassword(showToast = true): Promise<void> {
  const newPassword = await window.bromeo.regeneratePassword();
  updateSessionPassword(newPassword);
  if (showToast) toast("Nieuw sessiewachtwoord aangemaakt.");
}

async function saveDeviceLabel(): Promise<void> {
  const label = el.deviceLabel.value.trim();
  if (label.length < 2) {
    toast("Kies een herkenbare apparaatnaam van minimaal 2 tekens.");
    return;
  }
  deviceLabel = await window.bromeo.setDeviceLabel(label);
  el.deviceLabel.value = deviceLabel;
  el.overviewLabel.textContent = deviceLabel;
  toast("Apparaatnaam opgeslagen.");
}

function updatePasswordStrength(): void {
  const visible = el.unattendedToggle.checked;
  const password = el.unattendedPassword.value;
  let level: "" | "weak" | "ok" | "good" | "strong" = "";
  let label = "Minimaal 6 tekens";

  if (password) {
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) {
      level = "weak";
      label = "Zwak wachtwoord";
    } else if (score <= 3) {
      level = "ok";
      label = "Redelijk wachtwoord";
    } else if (score === 4) {
      level = "good";
      label = "Sterk wachtwoord";
    } else {
      level = "strong";
      label = "Zeer sterk wachtwoord";
    }
  }

  el.unattendedStrength.className = `password-strength${visible ? "" : " hidden"}${level ? ` password-strength--${level}` : ""}`;
  const labelEl = el.unattendedStrength.querySelector("strong");
  if (labelEl) labelEl.textContent = label;
}

function applyRemoteFitMode(mode: RemoteFitMode): void {
  const normalized: RemoteFitMode = ["fit", "actual", "stretch"].includes(mode) ? mode : "fit";
  el.videoWrap.dataset.fit = normalized;
  el.fitModeSelect.value = normalized;
  localStorage.setItem("bromeo:remote-fit-mode", normalized);
}

function applyQualityLevel(level: QualityLevel, notifyPeer = true): void {
  const normalized: QualityLevel = ["auto", "high", "low"].includes(level) ? level : "auto";
  el.qualitySelect.value = normalized;
  localStorage.setItem("bromeo:quality-level", normalized);
  if (notifyPeer && currentRole === "viewer" && currentSession) {
    currentSession.sendSystemCommand({ kind: "quality-request", level: normalized });
  }
}

function qualityLabel(level: QualityLevel): string {
  return { auto: "automatisch", high: "hoog", low: "laag" }[level];
}

function parseIdleTimeout(value: string | number | null): IdleTimeoutMinutes {
  const candidate = typeof value === "number" ? value : Number(value ?? 0);
  return IDLE_TIMEOUT_OPTIONS.includes(candidate as IdleTimeoutMinutes) ? (candidate as IdleTimeoutMinutes) : 0;
}

function applyIdleTimeout(value: string | number | null, showToast = true): void {
  idleTimeoutMinutes = parseIdleTimeout(value);
  el.idleTimeoutSelect.value = String(idleTimeoutMinutes);
  localStorage.setItem(IDLE_TIMEOUT_KEY, String(idleTimeoutMinutes));
  markSessionActivity();
  if (currentSession) startIdleTimer();
  if (!showToast) return;
  toast(
    idleTimeoutMinutes === 0
      ? "Automatisch verbreken bij inactiviteit is uitgeschakeld."
      : `Sessie wordt verbroken na ${idleTimeoutMinutes} minuten zonder activiteit.`
  );
}

function markSessionActivity(): void {
  if (!currentSession) return;
  lastSessionActivityAt = Date.now();
}

function startIdleTimer(): void {
  stopIdleTimer();
  lastSessionActivityAt = Date.now();
  if (idleTimeoutMinutes === 0) return;

  idleTimerHandle = setInterval(() => {
    if (!currentSession || idleTimeoutMinutes === 0) {
      stopIdleTimer();
      return;
    }
    const idleForMs = Date.now() - lastSessionActivityAt;
    if (idleForMs >= idleTimeoutMinutes * 60 * 1000) {
      toast(`Sessie automatisch verbroken na ${idleTimeoutMinutes} minuten inactiviteit.`);
      endSession();
    }
  }, 10_000);
}

function stopIdleTimer(): void {
  if (idleTimerHandle) clearInterval(idleTimerHandle);
  idleTimerHandle = null;
}

function parseRecordingMode(value: string | null): RecordingMode {
  return value === "auto" ? "auto" : "manual";
}

function applyRecordingMode(value: string | null, showToast = true): void {
  recordingMode = parseRecordingMode(value);
  el.recordingModeSelect.value = recordingMode;
  localStorage.setItem(RECORDING_MODE_KEY, recordingMode);
  if (showToast) {
    toast(recordingMode === "auto" ? "Automatische opname ingeschakeld voor uitgaande sessies." : "Opname staat weer op handmatig.");
  }
  if (recordingMode === "auto" && currentRole === "viewer" && el.remoteVideo.srcObject && (!mediaRecorder || mediaRecorder.state === "inactive")) {
    startRecording(true);
  }
}

function formatSessionStats(stats: { fps: number | null; bitrateKbps: number | null; rttMs: number | null }): string {
  const parts = [];
  if (stats.fps != null) parts.push(`${stats.fps} fps`);
  if (stats.bitrateKbps != null) {
    parts.push(stats.bitrateKbps >= 1000 ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps` : `${stats.bitrateKbps} kbps`);
  }
  if (stats.rttMs != null) parts.push(`${stats.rttMs} ms`);
  return parts.length > 0 ? parts.join(" | ") : "Meetgegevens volgen";
}

function toggleRemoteAudio(): void {
  remoteAudioMuted = !remoteAudioMuted;
  el.remoteVideo.muted = remoteAudioMuted;
  setIconButtonState(el.audioToggleBtn, remoteAudioMuted ? "Geluid aan" : "Geluid uit", remoteAudioMuted ? "icon-volume" : "icon-volume-x");
  toast(remoteAudioMuted ? "Geluid gedempt." : "Geluid ingeschakeld.");
}

function sendRemoteText(): void {
  const text = el.remoteTextInput.value;
  if (!text.trim()) {
    toast("Vul eerst tekst in.");
    return;
  }
  if (!currentSession || currentRole !== "viewer") return;
  if (sessionViewOnly) {
    toast("Tekst invoegen is uitgeschakeld in alleen-kijken modus.");
    return;
  }
  currentSession.sendInput({ kind: "text", value: text });
  toast("Tekst ingevoegd op het externe apparaat.");
  el.remoteTextInput.value = "";
  el.textPanel.classList.add("hidden");
  el.videoWrap.focus();
}

function sendShortcut(keys: Array<{ key: string; code: string }>): void {
  if (!currentSession || currentRole !== "viewer") return;
  if (sessionViewOnly) {
    toast("Sneltoetsen zijn uitgeschakeld in alleen-kijken modus.");
    return;
  }
  for (const key of keys) currentSession.sendInput({ kind: "keydown", ...key });
  for (const key of [...keys].reverse()) currentSession.sendInput({ kind: "keyup", ...key });
  el.videoWrap.focus();
}

function sendNamedShortcut(name: string): void {
  const shortcuts: Record<string, Array<{ key: string; code: string }>> = {
    "task-manager": [
      { key: "Control", code: "ControlLeft" },
      { key: "Shift", code: "ShiftLeft" },
      { key: "Escape", code: "Escape" },
    ],
    "alt-tab": [
      { key: "Alt", code: "AltLeft" },
      { key: "Tab", code: "Tab" },
    ],
    "win-r": [
      { key: "Meta", code: "MetaLeft" },
      { key: "r", code: "KeyR" },
    ],
    "ctrl-c": [
      { key: "Control", code: "ControlLeft" },
      { key: "c", code: "KeyC" },
    ],
    "ctrl-v": [
      { key: "Control", code: "ControlLeft" },
      { key: "v", code: "KeyV" },
    ],
    "ctrl-alt-del": [
      { key: "Control", code: "ControlLeft" },
      { key: "Alt", code: "AltLeft" },
      { key: "Delete", code: "Delete" },
    ],
  };
  const keys = shortcuts[name];
  if (!keys) return;
  sendShortcut(keys);
  el.shortcutsPanel.classList.add("hidden");
}

function toggleSessionPanel(panel: HTMLElement): void {
  const willOpen = panel.classList.contains("hidden");
  [el.filesPanel, el.chatPanel, el.textPanel, el.shortcutsPanel, el.notesPanel, el.aiBuddyPanel].forEach((p) => p.classList.add("hidden"));
  panel.classList.toggle("hidden", !willOpen);
  closeToolbarMenus();
}

function miniControllerState(peerId = currentPeerId): MiniControllerState | null {
  if (!peerId || currentRole !== "host") return null;
  return {
    peer: formatId(peerId),
    status: sessionViewOnly ? "Kijkt mee met dit apparaat" : "Bekijkt en bestuurt dit apparaat",
    permissions: permissionsSummary(sessionPermissions),
    canClipboard: sessionPermissions.clipboard,
    canScreenPower: true,
    screenOff: monitorIsOff,
  };
}

function updateMiniController(): void {
  const state = miniControllerState();
  if (state) window.bromeo.updateMiniController(state);
}

async function sendHostClipboard(): Promise<void> {
  if (!currentSession) return;
  if (!sessionPermissions.clipboard) {
    toast("Klembord delen is uitgeschakeld voor deze sessie.");
    return;
  }
  const text = await window.bromeo.getClipboard();
  currentSession.sendClipboard(text);
  toast("Klembord verzonden naar de partner.");
}

async function toggleHostScreenPower(): Promise<void> {
  monitorIsOff = !monitorIsOff;
  await window.bromeo.setMonitorPower(!monitorIsOff);
  el.curtainManualToggle.textContent = monitorIsOff ? "Scherm aan" : "Scherm uit";
  updateMiniController();
}

async function endSessionAndRotatePassword(): Promise<void> {
  endSession();
  await regenerateSessionPassword(false);
  toast("Sessie beÃ«indigd en wachtwoord gewijzigd.");
}

function openHostChatPanel(): void {
  window.bromeo.restoreMainWindow();
  el.hostChatPanel.classList.remove("hidden");
  el.hostChatInput.focus();
}

function handleMiniControllerAction(action: string): void {
  if (action === "clipboard") {
    sendHostClipboard();
  } else if (action === "chat") {
    openHostChatPanel();
  } else if (action === "screen-toggle") {
    toggleHostScreenPower();
  } else if (action === "end") {
    endSession();
  } else if (action === "panic") {
    endSessionAndRotatePassword();
  }
}

function closeToolbarMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".toolbar-menu").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.querySelector<HTMLElement>(".toolbar-menu-panel")?.classList.add("hidden");
  });
}

function wireToolbarMenus(): void {
  document.querySelectorAll<HTMLButtonElement>(".toolbar-menu-trigger").forEach((trigger) => {
    trigger.onclick = (event) => {
      event.stopPropagation();
      const menu = trigger.closest<HTMLElement>(".toolbar-menu");
      const panelId = trigger.dataset.menuTarget;
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!menu || !panel) return;
      const willOpen = panel.classList.contains("hidden");
      closeToolbarMenus(menu);
      menu.classList.toggle("is-open", willOpen);
      panel.classList.toggle("hidden", !willOpen);
    };
  });

  document.querySelectorAll<HTMLElement>(".toolbar-menu-panel").forEach((panel) => {
    panel.onclick = (event) => event.stopPropagation();
    panel.querySelectorAll<HTMLButtonElement>(".toolbar-menu-item").forEach((button) => {
      button.addEventListener("click", () => closeToolbarMenus());
    });
  });
}

function setBlockInputUi(enabled: boolean, pending = false): void {
  el.blockInputBtn.disabled = pending;
  el.blockInputBtn.classList.toggle("btn-danger", enabled);
  el.blockInputBtn.classList.toggle("btn-outline", !enabled);
  if (pending) {
    setIconButtonState(el.blockInputBtn, "Externe invoer blokkeren: aanvraag loopt");
  } else {
    setIconButtonState(el.blockInputBtn, enabled ? "Externe invoer geblokkeerd" : "Externe invoer blokkeren");
  }
}

function applyBlockInputStatus(enabled: boolean, ok: boolean): void {
  setBlockInputUi(ok && enabled);
  toast(
    ok
      ? enabled
        ? "Lokale invoer van de host geblokkeerd."
        : "Lokale invoer van de host niet meer geblokkeerd."
      : "Kon lokale invoer van de host niet blokkeren."
  );
}

function setLockOnEndUi(enabled: boolean, pending = false): void {
  el.lockOnEndBtn.disabled = pending;
  el.lockOnEndBtn.classList.toggle("btn-danger", enabled);
  el.lockOnEndBtn.classList.toggle("btn-outline", !enabled);
  setIconButtonState(el.lockOnEndBtn, pending ? "Vergrendel bij einde: aanvraag loopt" : enabled ? "Vergrendelt bij einde" : "Vergrendel bij einde");
}

function applyLockOnEndStatus(enabled: boolean, ok: boolean): void {
  setLockOnEndUi(ok && enabled);
  toast(
    ok
      ? enabled
        ? "Remote apparaat wordt vergrendeld bij sessie-einde."
        : "Vergrendelen bij sessie-einde uitgeschakeld."
      : "Kon vergrendelen bij sessie-einde niet instellen."
  );
}

function updateSessionState(state: RTCPeerConnectionState | "starting"): void {
  const labels: Record<typeof state, string> = {
    starting: "Verbinden",
    new: "Verbinden",
    connecting: "Verbinden",
    connected: "Verbonden",
    disconnected: "Onderbroken",
    failed: "Mislukt",
    closed: "Gesloten",
  };
  el.sessionState.textContent = labels[state];
  el.sessionState.classList.toggle("session-chip--ok", state === "connected");
  el.sessionState.classList.toggle("session-chip--danger", state === "failed" || state === "closed");
  el.sessionState.classList.toggle("session-chip--pending", state !== "connected" && state !== "failed" && state !== "closed");
}

function setTotpUiState(enabled: boolean): void {
  el.totpDisabledState.classList.toggle("hidden", enabled);
  el.totpSetup.classList.add("hidden");
  el.totpEnabledState.classList.toggle("hidden", !enabled);
}

function setSasUiState(installed: boolean, pending = false): void {
  el.sasInstallBtn.disabled = pending;
  el.sasInstallBtn.textContent = pending ? "Bezig…" : "Inschakelen…";
  el.sasDisabledState.classList.toggle("hidden", installed);
  el.sasEnabledState.classList.toggle("hidden", !installed);
}

function startIncomingTimeout(): void {
  clearIncomingTimeout();
  incomingExpiresAt = Date.now() + 60_000;
  updateIncomingTimeout();
  incomingTimerHandle = setInterval(updateIncomingTimeout, 1000);
}

function clearIncomingTimeout(): void {
  if (incomingTimerHandle) clearInterval(incomingTimerHandle);
  incomingTimerHandle = null;
  incomingExpiresAt = 0;
}

function updateIncomingTimeout(): void {
  if (!pendingIncoming || incomingExpiresAt === 0) return;
  const remaining = Math.max(0, Math.ceil((incomingExpiresAt - Date.now()) / 1000));
  el.incomingTimeout.textContent = `Aanvraag verloopt over ${remaining} seconden.`;
  if (remaining > 0) return;
  const { fromId } = pendingIncoming;
  pendingIncoming = null;
  clearIncomingTimeout();
  el.incomingModal.classList.add("hidden");
  signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "declined" });
  toast("Inkomende verbindingsaanvraag verlopen.");
}

function wireUi(): void {
  wireToolbarMenus();
  el.deviceLabelSave.onclick = () => saveDeviceLabel();
  el.deviceLabel.onkeydown = (e) => {
    if (e.key === "Enter") saveDeviceLabel();
  };
  el.copyId.onclick = () => copyWithFeedback(myId, el.copyId, "ID gekopieerd.");
  el.copyPassword.onclick = () => copyWithFeedback(el.myPassword.textContent ?? "", el.copyPassword, "Wachtwoord gekopieerd.");
  el.copyInvite.onclick = () => copyWithFeedback(buildInviteText(), el.copyInvite, "Uitnodiging gekopieerd.");
  el.regeneratePassword.onclick = () => regenerateSessionPassword();

  el.themeToggle.onclick = async () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    updateThemeIcon(next);
    await window.bromeo.setTheme(next);
  };

  el.unattendedToggle.onchange = () => {
    el.unattendedForm.classList.toggle("hidden", !el.unattendedToggle.checked);
    updatePasswordStrength();
  };
  el.unattendedPassword.oninput = () => updatePasswordStrength();
  el.unattendedSave.onclick = async () => {
    const enabled = el.unattendedToggle.checked;
    const pw = el.unattendedPassword.value.trim();
    if (enabled && pw.length < 6) {
      toast("Kies een wachtwoord van minstens 6 tekens.");
      return;
    }
    const result = await window.bromeo.setUnattended(enabled, pw || null);
    el.unattendedToggle.checked = result.unattendedEnabled;
    el.unattendedPassword.value = "";
    toast("Instelling voor onbeheerde toegang opgeslagen.");
  };

  el.connectBtn.onclick = onConnectClick;
  el.savedDevicesFilter.oninput = () => renderSavedDevices();
  el.clearSessionHistory.onclick = () => {
    setSessionHistory([]);
    renderSessionHistory();
    toast("Sessiegeschiedenis gewist.");
  };
  el.targetId.oninput = () => {
    el.targetId.value = formatIdInput(el.targetId.value);
  };
  [el.targetId, el.targetPassword].forEach((input) => {
    input.onkeydown = (e) => {
      if (e.key === "Enter") onConnectClick();
    };
  });

  el.sharingEnd.onclick = () => endSession();
  el.sharingPanic.onclick = async () => {
    endSession();
    await regenerateSessionPassword(false);
    toast("Sessie beëindigd en wachtwoord gewijzigd.");
  };
  el.hostClipboardBtn.onclick = async () => {
    if (!currentSession) return;
    if (!sessionPermissions.clipboard) {
      toast("Klembord delen is uitgeschakeld voor deze sessie.");
      return;
    }
    const text = await window.bromeo.getClipboard();
    currentSession.sendClipboard(text);
    toast("Klembord verzonden naar de partner.");
  };
  el.sharingPanic.onclick = () => endSessionAndRotatePassword();
  el.hostClipboardBtn.onclick = () => sendHostClipboard();
  window.bromeo.onMiniControllerAction(handleMiniControllerAction);

  el.incomingAccept.onclick = () => respondToIncoming(true);
  el.incomingDecline.onclick = () => respondToIncoming(false);

  el.disconnectBtn.onclick = () => endSession();
  el.fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) el.sessionView.requestFullscreen();
    else document.exitFullscreen();
  };
  document.addEventListener("fullscreenchange", () => {
    setIconButtonState(el.fullscreenBtn, document.fullscreenElement ? "Venster" : "Volledig scherm", document.fullscreenElement ? "icon-window" : "icon-fullscreen");
  });
  el.fitModeSelect.onchange = () => {
    applyRemoteFitMode(el.fitModeSelect.value as RemoteFitMode);
  };
  el.filesToggleBtn.onclick = () => toggleSessionPanel(el.filesPanel);
  el.audioToggleBtn.onclick = () => toggleRemoteAudio();
  el.clipboardBtn.onclick = async () => {
    if (!sessionPermissions.clipboard) {
      toast("Klembord delen is uitgeschakeld voor deze sessie.");
      return;
    }
    const text = await window.bromeo.getClipboard();
    currentSession?.sendClipboard(text);
    toast("Klembord verzonden naar de partner.");
  };
  el.textToggleBtn.onclick = () => {
    if (sessionViewOnly) {
      toast("Tekst invoegen is uitgeschakeld in alleen-kijken modus.");
      return;
    }
    toggleSessionPanel(el.textPanel);
    if (!el.textPanel.classList.contains("hidden")) el.remoteTextInput.focus();
  };
  el.remoteTextSendBtn.onclick = () => sendRemoteText();
  el.remoteTextClearBtn.onclick = () => {
    el.remoteTextInput.value = "";
    el.remoteTextInput.focus();
  };
  el.shortcutsToggleBtn.onclick = () => {
    if (sessionViewOnly) {
      toast("Sneltoetsen zijn uitgeschakeld in alleen-kijken modus.");
      return;
    }
    toggleSessionPanel(el.shortcutsPanel);
  };
  el.notesToggleBtn.onclick = () => toggleSessionPanel(el.notesPanel);
  el.shortcutsPanel.querySelectorAll<HTMLButtonElement>(".shortcut-btn").forEach((btn) => {
    btn.onclick = () => sendNamedShortcut(btn.dataset.shortcut ?? "");
  });
  el.sendFileBtn.onclick = async () => {
    if (!sessionPermissions.files) {
      toast("Bestandsoverdracht is uitgeschakeld voor deze sessie.");
      return;
    }
    const file = await window.bromeo.pickFile();
    if (!file) return;
    const base64 = await window.bromeo.readFileBase64(file.path);
    await currentSession?.sendFile(file.name, base64);
    filesTransferredCount++;
    toast(`Verzonden: ${file.name}`);
  };
  el.recordToggleBtn.onclick = () => toggleRecording();

  el.chatToggleBtn.onclick = () => toggleSessionPanel(el.chatPanel);
  el.chatSendBtn.onclick = () => sendChatMessage(el.chatInput);
  el.chatInput.onkeydown = (e) => {
    if (e.key === "Enter") sendChatMessage(el.chatInput);
  };
  el.hostChatToggleBtn.onclick = () => el.hostChatPanel.classList.toggle("hidden");
  el.hostChatSendBtn.onclick = () => sendChatMessage(el.hostChatInput);
  el.hostChatInput.onkeydown = (e) => {
    if (e.key === "Enter") sendChatMessage(el.hostChatInput);
  };

  el.aiBuddyToggleBtn.onclick = () => toggleSessionPanel(el.aiBuddyPanel);
  el.aiBuddyScreenshotBtn.onclick = () => {
    const frame = captureRemoteVideoFrame();
    if (!frame) {
      toast("Kon geen screenshot maken — is het beeld al geladen?");
      return;
    }
    setAiBuddyScreenshot(frame);
  };
  el.aiBuddyScreenshotRemove.onclick = () => clearAiBuddyScreenshot();
  el.aiBuddySendBtn.onclick = () => sendAiBuddyMessage();
  el.aiBuddyInput.onkeydown = (e) => {
    if (e.key === "Enter") sendAiBuddyMessage();
  };

  el.restartBtn.onclick = () => {
    if (!currentSession || currentRole !== "viewer") return;
    el.restartTarget.textContent = el.sessionPeer.textContent;
    el.restartConfirmModal.classList.remove("hidden");
  };
  el.restartCancelBtn.onclick = () => el.restartConfirmModal.classList.add("hidden");
  el.restartConfirmBtn.onclick = () => {
    el.restartConfirmModal.classList.add("hidden");
    if (!currentSession || !lastConnectAttempt) return;
    currentSession.sendSystemCommand({ kind: "restart-request" });
    restartRequestedFor = lastConnectAttempt.targetId;
    toast("Herstart aangevraagd. BromeoRemote probeert straks automatisch opnieuw te verbinden.");
  };

  // No confirmation modal here (unlike restart) — locking doesn't disconnect
  // the session or lose work, and is trivially reversible with the host's
  // own credentials.
  el.lockBtn.onclick = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "lock-request" });
    toast("Vergrendelen aangevraagd.");
  };
  el.lockOnEndBtn.onclick = () => {
    if (!currentSession) return;
    const enabling = !el.lockOnEndBtn.classList.contains("btn-danger");
    currentSession.sendSystemCommand({ kind: "lock-on-session-end", enabled: enabling });
    setLockOnEndUi(enabling, true);
  };

  // Toggle button: shows a "pending" state immediately, then reconciles to
  // the host's actual result once "block-input-status" comes back (the host
  // may fail to apply it, e.g. insufficient privileges) — see
  // onSystemCommand's "block-input-status" case in startViewerSession.
  el.blockInputBtn.onclick = () => {
    if (!currentSession) return;
    const enabling = !el.blockInputBtn.classList.contains("btn-danger");
    currentSession.sendSystemCommand({ kind: "block-input", enabled: enabling });
    setBlockInputUi(enabling, true);
  };

  el.ctrlAltDelBtn.onclick = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "ctrl-alt-del-request" });
  };

  el.sasInstallBtn.onclick = async () => {
    setSasUiState(false, true);
    const installed = await window.bromeo.sasInstall();
    setSasUiState(installed);
    toast(installed ? "Ctrl+Alt+Del op afstand ingeschakeld." : "Inschakelen geannuleerd of mislukt.");
  };

  el.sasUninstallBtn.onclick = async () => {
    const success = await window.bromeo.sasUninstall(); // true = now uninstalled
    setSasUiState(!success);
    toast(success ? "Ctrl+Alt+Del op afstand uitgeschakeld." : "Uitschakelen geannuleerd of mislukt.");
  };

  el.monitorSelect.onchange = () => {
    if (!currentSession) return;
    currentSession.sendSystemCommand({ kind: "switch-monitor", monitorId: el.monitorSelect.value });
  };

  el.qualitySelect.onchange = () => {
    applyQualityLevel(el.qualitySelect.value as QualityLevel);
    toast(`Kwaliteit ingesteld op ${qualityLabel(el.qualitySelect.value as QualityLevel)}.`);
  };
  el.idleTimeoutSelect.onchange = () => applyIdleTimeout(el.idleTimeoutSelect.value);
  el.recordingModeSelect.onchange = () => applyRecordingMode(el.recordingModeSelect.value);
  ["mousemove", "mousedown", "wheel", "keydown", "click"].forEach((eventName) => {
    el.sessionView.addEventListener(eventName, markSessionActivity);
  });

  el.curtainToggle.onchange = async () => {
    curtainModeEnabled = await window.bromeo.setCurtainMode(el.curtainToggle.checked);
  };
  el.trustedOnlyToggle.onchange = () => {
    trustedOnlyConnections = el.trustedOnlyToggle.checked;
    localStorage.setItem(TRUSTED_ONLY_KEY, trustedOnlyConnections ? "1" : "0");
    toast(trustedOnlyConnections ? "Alleen opgeslagen apparaten mogen nu verbinden." : "Ook onbekende apparaten kunnen weer een aanvraag sturen.");
  };
  el.curtainManualToggle.onclick = () => toggleHostScreenPower();

  el.totpStartSetup.onclick = async () => {
    const { secret } = await window.bromeo.generateTotpSecret();
    el.totpSecret.textContent = secret;
    el.totpVerifyCode.value = "";
    el.totpDisabledState.classList.add("hidden");
    el.totpSetup.classList.remove("hidden");
  };
  el.totpCopy.onclick = () => {
    navigator.clipboard.writeText(el.totpSecret.textContent ?? "");
    toast("Sleutel gekopieerd.");
  };
  el.totpConfirm.onclick = async () => {
    const { ok } = await window.bromeo.enableTotp(el.totpVerifyCode.value.trim());
    if (!ok) {
      toast("Onjuiste code. Controleer of je authenticator-app de juiste sleutel gebruikt en probeer opnieuw.");
      return;
    }
    setTotpUiState(true);
    toast("2FA is ingeschakeld voor onbeheerde toegang.");
  };
  el.totpDisable.onclick = async () => {
    await window.bromeo.disableTotp();
    setTotpUiState(false);
    toast("2FA is uitgeschakeld.");
  };
  el.totpRequiredCancel.onclick = () => {
    el.totpRequiredModal.classList.add("hidden");
    el.connectStatus.textContent = "";
  };
  el.totpRequiredSubmit.onclick = () => {
    if (!lastConnectAttempt) return;
    const code = el.totpRequiredInput.value.trim();
    el.totpRequiredModal.classList.add("hidden");
    connectByIdAndHash(lastConnectAttempt.targetId, lastConnectAttempt.passwordHash, lastConnectAttempt.viewOnly, lastConnectAttempt.permissions, code);
  };

  el.checkUpdatesBtn.onclick = () => window.bromeo.checkForUpdates();
  el.installUpdateBtn.onclick = () => window.bromeo.installUpdate();

  el.notifyForwardSave.onclick = async () => {
    const val = el.notifyForwardId.value.replace(/\s+/g, "");
    if (val && !/^\d{9}$/.test(val)) {
      toast("Vul een geldig 9-cijferig BromeoRemote-ID in, of laat het veld leeg.");
      return;
    }
    notifyForwardId = await window.bromeo.setNotifyForward(val || null);
    toast(notifyForwardId ? `Meldingen worden ook doorgestuurd naar ${formatId(notifyForwardId)}.` : "Doorsturen van meldingen uitgeschakeld.");
  };
  el.openaiKeySave.onclick = async () => {
    const key = el.openaiKeyInput.value.trim();
    const hasKey = await window.bromeo.setOpenAiKey(key || null);
    el.openaiKeyInput.value = "";
    el.openaiKeyStatus.textContent = hasKey ? "Sleutel ingesteld en versleuteld opgeslagen." : "Nog geen sleutel ingesteld.";
    toast(hasKey ? "OpenAI-sleutel opgeslagen." : "OpenAI-sleutel verwijderd.");
  };
  el.notifyBellBtn.onclick = () => {
    el.notifyPanel.classList.toggle("hidden");
    if (!el.notifyPanel.classList.contains("hidden")) {
      unseenNotifyCount = 0;
      updateNotifyBadge();
    }
  };
  el.notifyClearBtn.onclick = () => {
    notifyHistory = [];
    renderNotifyList();
  };
  el.bridgeConfirmAllow.onclick = () => answerActiveConfirm("allow");
  el.bridgeConfirmDeny.onclick = () => answerActiveConfirm("deny");
  el.bridgeConfirmView.onclick = () => viewActiveConfirmOrigin();

  el.rememberDevice.onchange = () => {
    el.rememberLabel.classList.toggle("hidden", !el.rememberDevice.checked);
    el.rememberGroup.classList.toggle("hidden", !el.rememberDevice.checked);
    el.rememberMac.classList.toggle("hidden", !el.rememberDevice.checked);
  };
  el.viewOnlyToggle.onchange = () => syncPermissionControlUi();
  el.permissionControl.onchange = () => {
    if (!el.permissionControl.checked) el.viewOnlyToggle.checked = true;
    syncPermissionControlUi();
  };
  syncPermissionControlUi();

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!(target instanceof Element) || !target.closest(".toolbar-menu")) {
      closeToolbarMenus();
    }
    if (!el.notifyPanel.classList.contains("hidden") && !el.notifyPanel.contains(target) && !el.notifyBellBtn.contains(target)) {
      el.notifyPanel.classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeToolbarMenus();
  });

  wireRemoteControlCapture();
}

async function onConnectClick(): Promise<void> {
  const targetId = el.targetId.value.replace(/\s+/g, "");
  const password = el.targetPassword.value;
  if (!/^\d{9}$/.test(targetId)) {
    toast("Vul een geldig 9-cijferig BromeoRemote-ID in.");
    return;
  }
  const passwordHash = await sha256Hex(password);
  const permissions = permissionsFromUi();
  connectByIdAndHash(targetId, passwordHash, !permissions.control, permissions);
}

function connectByIdAndHash(targetId: string, passwordHash: string, viewOnly: boolean, permissions = defaultPermissions(viewOnly), totpCode?: string): void {
  if (currentSession) {
    toast("Er is al een actieve sessie.");
    return;
  }
  const normalizedPermissions = normalizePermissions(permissions, viewOnly);
  lastConnectAttempt = { targetId, passwordHash, viewOnly: !normalizedPermissions.control, permissions: normalizedPermissions };
  el.connectStatus.textContent = "Verbinding maken…";
  signaling.send({
    type: "connect-request",
    targetId,
    fromId: myId,
    fromLabel: deviceLabel,
    passwordHash,
    viewOnly: !normalizedPermissions.control,
    permissions: normalizedPermissions,
    totpCode,
  });
}

function connectToSavedDevice(device: SavedDevice): void {
  connectByIdAndHash(device.id, device.passwordHash, device.viewOnly, normalizePermissions(device.permissions, device.viewOnly));
}

function scheduleAutoReconnect(targetId: string, passwordHash: string, viewOnly: boolean, permissions: SessionPermissions): void {
  const intervalMs = 15_000;
  const maxAttempts = 20; // ~5 minutes
  let attempt = 0;
  toast(`Verbinding verbroken. BromeoRemote probeert automatisch opnieuw te verbinden met ${formatId(targetId)}…`);
  const tryOnce = () => {
    attempt++;
    if (currentSession || attempt > maxAttempts) return;
    connectByIdAndHash(targetId, passwordHash, viewOnly, permissions);
    setTimeout(tryOnce, intervalMs);
  };
  setTimeout(tryOnce, intervalMs);
}

function viewActiveConfirmOrigin(): void {
  if (!activeConfirm || activeConfirm.origin !== "remote" || !activeConfirm.replyTo) return;
  const targetId = activeConfirm.replyTo;
  // Only hides the dialog — the confirmation itself stays pending (and will
  // still safely time out to "deny") until it's actually answered.
  el.bridgeConfirmModal.classList.add("hidden");
  const saved = savedDevices.find((d) => d.id === targetId);
  if (saved) {
    connectToSavedDevice(saved);
  } else {
    el.targetId.value = formatId(targetId);
    el.targetPassword.focus();
    toast("Vul het wachtwoord van dat apparaat in om live mee te kijken.");
  }
}

// --- Saved / trusted devices (one-tap reconnect) ---

function renderSavedDevices(): void {
  if (savedDevices.length === 0) {
    el.savedDevicesFilter.classList.add("hidden");
    el.savedDevicesList.classList.add("hidden");
    el.savedDevicesList.innerHTML = "";
    return;
  }
  el.savedDevicesFilter.classList.remove("hidden");
  el.savedDevicesList.classList.remove("hidden");

  const filter = el.savedDevicesFilter.value.trim().toLocaleLowerCase("nl-NL");
  const visibleDevices = filter
    ? savedDevices.filter((d) => {
        const haystack = [d.label, d.id, formatId(d.id), d.group ?? "", d.mac ?? ""].join(" ").toLocaleLowerCase("nl-NL");
        return haystack.includes(filter);
      })
    : savedDevices;

  if (visibleDevices.length === 0) {
    el.savedDevicesList.innerHTML = '<p class="muted small">Geen opgeslagen apparaten gevonden.</p>';
    return;
  }

  const favorites = visibleDevices.filter((d) => d.favorite);
  const rest = visibleDevices.filter((d) => !d.favorite);
  const groups = new Map<string, SavedDevice[]>();
  for (const d of rest) {
    const key = d.group?.trim() || "Overig";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }
  const sortedGroupNames = [...groups.keys()].sort((a, b) => (a === "Overig" ? 1 : b === "Overig" ? -1 : a.localeCompare(b)));

  let html = "";
  if (favorites.length > 0) html += renderDeviceRows(favorites, "Favorieten");
  for (const name of sortedGroupNames) html += renderDeviceRows(groups.get(name)!, name);
  el.savedDevicesList.innerHTML = html;

  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-connect-btn").forEach((btn) => {
    btn.onclick = () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (device) connectToSavedDevice(device);
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-device-remove").forEach((btn) => {
    btn.onclick = async () => {
      savedDevices = await window.bromeo.removeSavedDevice(btn.dataset.id!);
      renderSavedDevices();
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-wake-btn").forEach((btn) => {
    btn.onclick = async () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (!device?.mac) return;
      const res = await window.bromeo.wakeDevice(device.mac);
      toast(res.ok ? `Wake-on-LAN-signaal verstuurd naar "${device.label}".` : `Kon niet wekken: ${res.error}`);
    };
  });
  el.savedDevicesList.querySelectorAll<HTMLButtonElement>(".saved-favorite-btn").forEach((btn) => {
    btn.onclick = async () => {
      const device = savedDevices.find((d) => d.id === btn.dataset.id);
      if (!device) return;
      savedDevices = await window.bromeo.saveDevice({ ...device, favorite: !device.favorite });
      renderSavedDevices();
    };
  });
}

function renderDeviceRows(devices: SavedDevice[], groupLabel: string): string {
  const rows = devices
    .map(
      (d) => `<div class="saved-device-row">
        <button class="saved-favorite-btn ${d.favorite ? "is-active" : ""}" data-id="${d.id}" title="${d.favorite ? "Favoriet verwijderen" : "Als favoriet markeren"}">${d.favorite ? "★" : "☆"}</button>
        <div class="saved-device-info">
          <div class="saved-device-label"><span>${escapeHtml(d.label)}</span> ${permissionBadges(normalizePermissions(d.permissions, d.viewOnly))}</div>
          <div class="saved-device-id">${formatId(d.id)}</div>
        </div>
        ${d.mac ? `<button class="btn btn-outline btn-sm saved-wake-btn" data-id="${d.id}" title="Wake-on-LAN">Wek</button>` : ""}
        <button class="btn btn-primary btn-sm saved-connect-btn" data-id="${d.id}">Verbinden</button>
        <button class="saved-device-remove" data-id="${d.id}" title="Verwijderen">✕</button>
      </div>`
    )
    .join("");
  return `<div class="saved-devices-group"><div class="saved-devices-group-label">${escapeHtml(groupLabel)}</div>${rows}</div>`;
}

function getSessionHistory(): SessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SESSION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setSessionHistory(history: SessionHistoryEntry[]): void {
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history.slice(0, 25)));
}

function renderSessionHistory(): void {
  const history = getSessionHistory();
  if (history.length === 0) {
    el.sessionHistoryList.innerHTML = '<p class="muted small">Nog geen sessies.</p>';
    return;
  }
  el.sessionHistoryList.innerHTML = history
    .map((entry) => {
      const started = new Date(entry.startedAt).toLocaleString("nl-NL", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const direction = entry.role === "viewer" ? "Uitgaand" : "Inkomend";
      const mode = entry.viewOnly ? "Alleen kijken" : "Besturing";
      const permissions = permissionsSummary(normalizePermissions(entry.permissions, entry.viewOnly));
      const duration = formatDuration(entry.durationSec);
      const recorded = entry.recorded ? " | opname" : "";
      const note = entry.note ? `<div class="history-note">${escapeHtml(entry.note)}</div>` : "";
      return `<div class="history-row">
        <div class="history-main">
          <strong>${direction} - ${formatId(entry.peerId)}</strong>
          <span>${started} | ${duration} | ${mode} | ${permissions} | ${entry.filesTransferred} bestand(en)${recorded}</span>
          ${note}
        </div>
      </div>`;
    })
    .join("");
}

function saveSessionHistoryEntry(entry: SessionHistoryEntry): void {
  const history = getSessionHistory();
  history.unshift(entry);
  setSessionHistory(history);
  renderSessionHistory();
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

async function maybeSaveDeviceAfterConnect(targetId: string): Promise<void> {
  if (!el.rememberDevice.checked || lastConnectAttempt?.targetId !== targetId) return;
  const label = el.rememberLabel.value.trim() || formatId(targetId);
  const group = el.rememberGroup.value.trim() || undefined;
  const macInput = el.rememberMac.value.trim();
  const macValid = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(macInput);
  if (macInput && !macValid) toast("MAC-adres genegeerd (ongeldig formaat), rest is wel opgeslagen.");
  const existing = savedDevices.find((d) => d.id === targetId);
  savedDevices = await window.bromeo.saveDevice({
    id: targetId,
    label,
    passwordHash: lastConnectAttempt.passwordHash,
    viewOnly: lastConnectAttempt.viewOnly,
    permissions: lastConnectAttempt.permissions,
    mac: macValid ? macInput : undefined,
    group,
    favorite: existing?.favorite ?? false,
  });
  renderSavedDevices();
  el.rememberDevice.checked = false;
  el.rememberLabel.value = "";
  el.rememberLabel.classList.add("hidden");
  el.rememberGroup.value = "";
  el.rememberGroup.classList.add("hidden");
  el.rememberMac.value = "";
  el.rememberMac.classList.add("hidden");
  toast(`"${label}" opgeslagen voor één-tik verbinden.`);
}

function onServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      myId = msg.id;
      el.myId.textContent = formatId(msg.id);
      el.overviewId.textContent = formatId(msg.id);
      break;

    case "error":
      toast(msg.message);
      break;

    case "incoming-request":
      handleIncomingRequest(msg.fromId, msg.passwordHash, !!msg.viewOnly, msg.permissions, msg.totpCode, msg.fromLabel);
      break;

    case "connect-response":
      handleConnectResponse(msg.fromId, msg.accept, msg.reason);
      break;

    case "signal":
      handleSignal(msg.fromId, msg.payload);
      break;

    case "peer-disconnected":
      if (currentSession) {
        toast("De partner heeft de verbinding verbroken.");
        endSession();
      }
      break;

    case "notify":
      handleIncomingNotify(msg.fromId, msg.notification);
      break;

    case "notify-response":
      window.bromeo.sendBridgeDecision(msg.notificationId, msg.decision);
      dismissConfirmIfMatches(msg.notificationId, msg.decision);
      break;
  }
}

// --- Agent notification bridge (e.g. Google Antigravity needing your confirmation) ---

function handleBridgeNotification(notification: NotificationPayload): void {
  const entry: NotifyHistoryEntry = { ...notification, origin: "local" };
  addNotifyHistory(entry);
  // Forwarding is meant as phone-only redirection, not a copy — showing the
  // interactive confirm dialog (or even just a toast) here too meant two
  // places both prompted for the same request, confusing about which one
  // "counts". Still recorded in history either way, just without the
  // popup/toast when it's headed to the phone instead.
  if (notifyForwardId) {
    signaling.send({ type: "notify", targetId: notifyForwardId, fromId: myId, notification });
  } else if (notification.kind === "confirm") {
    enqueueConfirm(entry);
  } else {
    toast(`${notification.source}: ${notification.title}`);
  }
}

function handleIncomingNotify(fromId: string, notification: NotificationPayload): void {
  const entry: NotifyHistoryEntry = { ...notification, origin: "remote", replyTo: fromId };
  addNotifyHistory(entry);
  if (notification.kind === "confirm") enqueueConfirm(entry);
  else toast(`${notification.source}: ${notification.title}`);
}

function addNotifyHistory(entry: NotifyHistoryEntry): void {
  notifyHistory.unshift(entry);
  if (notifyHistory.length > 20) notifyHistory.length = 20;
  if (el.notifyPanel.classList.contains("hidden")) {
    unseenNotifyCount++;
    updateNotifyBadge();
  }
  renderNotifyList();
}

function updateNotifyStatus(id: string, status: "allow" | "deny"): void {
  const entry = notifyHistory.find((n) => n.id === id);
  if (entry) entry.status = status;
  renderNotifyList();
}

function updateNotifyBadge(): void {
  el.notifyBadge.textContent = String(unseenNotifyCount);
  el.notifyBadge.classList.toggle("hidden", unseenNotifyCount === 0);
}

function enqueueConfirm(entry: NotifyHistoryEntry): void {
  confirmQueue.push(entry);
  if (!activeConfirm) showNextConfirm();
}

function showNextConfirm(): void {
  activeConfirm = confirmQueue.shift() ?? null;
  if (!activeConfirm) {
    el.bridgeConfirmModal.classList.add("hidden");
    return;
  }
  el.bridgeConfirmTitle.textContent = activeConfirm.title;
  el.bridgeConfirmSource.textContent = activeConfirm.source;
  el.bridgeConfirmMessage.textContent = activeConfirm.message;
  el.bridgeConfirmView.classList.toggle("hidden", activeConfirm.origin !== "remote");
  if (activeConfirm.command) {
    el.bridgeConfirmCommand.textContent = activeConfirm.command;
    el.bridgeConfirmCommand.classList.remove("hidden");
  } else {
    el.bridgeConfirmCommand.classList.add("hidden");
  }
  if (activeConfirm.riskLevel) {
    el.bridgeConfirmRisk.textContent = riskLabel(activeConfirm.riskLevel);
    el.bridgeConfirmRisk.className = `risk-badge risk-badge--${activeConfirm.riskLevel}`;
  } else {
    el.bridgeConfirmRisk.classList.add("hidden");
  }
  el.bridgeConfirmModal.classList.remove("hidden");
}

function riskLabel(level: "low" | "medium" | "high"): string {
  return { low: "Laag risico", medium: "Middelmatig risico", high: "Hoog risico" }[level];
}

function answerActiveConfirm(decision: "allow" | "deny"): void {
  if (!activeConfirm) return;
  const entry = activeConfirm;
  updateNotifyStatus(entry.id, decision);
  if (entry.origin === "local") {
    window.bromeo.sendBridgeDecision(entry.id, decision);
  } else if (entry.replyTo) {
    signaling.send({ type: "notify-response", targetId: entry.replyTo, notificationId: entry.id, decision });
  }
  showNextConfirm();
}

function dismissConfirmIfMatches(id: string, decision: "allow" | "deny"): void {
  updateNotifyStatus(id, decision);
  confirmQueue = confirmQueue.filter((n) => n.id !== id);
  if (activeConfirm?.id === id) showNextConfirm();
}

function renderNotifyList(): void {
  if (notifyHistory.length === 0) {
    el.notifyList.innerHTML = '<p class="muted small">Nog geen meldingen.</p>';
    return;
  }
  el.notifyList.innerHTML = notifyHistory
    .map((n) => {
      const time = new Date(n.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      const status =
        n.status === "allow"
          ? '<div class="notify-item-status allow">✓ Bevestigd</div>'
          : n.status === "deny"
            ? '<div class="notify-item-status deny">✕ Geweigerd</div>'
            : "";
      const risk = n.riskLevel ? `<span class="risk-badge risk-badge--${n.riskLevel}">${riskLabel(n.riskLevel)}</span>` : "";
      const command = n.command ? `<pre class="notify-command">${escapeHtml(n.command)}</pre>` : "";
      return `<div class="notify-item">
        <div class="notify-item-top"><span>${escapeHtml(n.title)}</span><span class="notify-item-time">${time}</span></div>
        <div class="notify-item-source">${escapeHtml(n.source)} ${risk}</div>
        <div class="notify-item-message">${escapeHtml(n.message)}</div>
        ${command}
        ${status}
      </div>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function handleIncomingRequest(
  fromId: string,
  passwordHash: string,
  viewOnly: boolean,
  permissions: SessionPermissions | undefined,
  totpCode?: string,
  fromLabel?: string
): Promise<void> {
  if (currentSession) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "busy" });
    return;
  }
  if (trustedOnlyConnections && !savedDevices.some((d) => d.id === fromId)) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "not-trusted" });
    const name = fromLabel?.trim();
    toast(`Verbinding van onbekend apparaat geweigerd${name ? `: ${name}` : ""}.`);
    return;
  }
  const check = await window.bromeo.checkPassword(passwordHash, totpCode);
  if (!check.ok) {
    signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: check.reason ?? "bad-password" });
    return;
  }
  if (check.mode === "unattended") {
    acceptIncoming(fromId, viewOnly, normalizePermissions(permissions, viewOnly));
    return;
  }
  const normalizedPermissions = normalizePermissions(permissions, viewOnly);
  pendingIncoming = { fromId, viewOnly: !normalizedPermissions.control, permissions: normalizedPermissions };
  const known = savedDevices.find((d) => d.id === fromId);
  const name = fromLabel?.trim() || known?.label;
  el.incomingFrom.textContent = name ? `${name} (${formatId(fromId)})` : formatId(fromId);
  el.incomingAction.textContent = `met rechten: ${permissionsSummary(normalizedPermissions)}`;
  startIncomingTimeout();
  el.incomingModal.classList.remove("hidden");
}

function respondToIncoming(accept: boolean): void {
  el.incomingModal.classList.add("hidden");
  clearIncomingTimeout();
  if (!pendingIncoming) return;
  const { fromId, viewOnly, permissions } = pendingIncoming;
  pendingIncoming = null;
  if (accept) acceptIncoming(fromId, viewOnly, permissions);
  else signaling.send({ type: "connect-response", targetId: fromId, accept: false, reason: "declined" });
}

function acceptIncoming(fromId: string, viewOnly: boolean, permissions: SessionPermissions): void {
  signaling.send({ type: "connect-response", targetId: fromId, accept: true });
  startHostSession(fromId, viewOnly, permissions);
}

function startHostSession(peerId: string, viewOnly: boolean, permissions = defaultPermissions(viewOnly)): void {
  currentRole = "host";
  currentPeerId = peerId;
  sessionPermissions = normalizePermissions(permissions, viewOnly);
  sessionViewOnly = !sessionPermissions.control;
  sessionStartedAt = Date.now();
  filesTransferredCount = 0;
  sessionWasRecorded = false;
  startSessionClock();
  currentSession = new PeerSession("host", DEFAULT_ICE_SERVERS, signaling, peerId, {
    onConnectionState: (state) => onHostConnectionState(peerId, state),
    // Enforced host-side, not just hidden in the viewer's UI — a view-only
    // session must never be able to move the mouse or type on this machine.
    onInputEvent: (event: InputEvent) => {
      if (sessionPermissions.control) window.bromeo.applyInput(event);
    },
    onClipboard: async (text) => {
      if (!sessionPermissions.clipboard) {
        toast("Klembord ontvangen, maar geweigerd door sessierechten.");
        return;
      }
      await window.bromeo.setClipboard(text);
      toast(`Klembord ontvangen (${text.length} tekens).`);
    },
    onChatMessage: (text, timestamp) => receiveChatMessage(text, timestamp),
    // Same enforcement principle as onInputEvent: a view-only session can
    // never trigger a restart, no matter what the viewer's client sends.
    onSystemCommand: async (cmd) => {
      if (cmd.kind === "restart-request") {
        if (sessionPermissions.control) window.bromeo.restartComputer();
      } else if (cmd.kind === "lock-request") {
        if (sessionPermissions.control) window.bromeo.lockComputer();
      } else if (cmd.kind === "lock-on-session-end") {
        lockOnSessionEnd = sessionPermissions.control && cmd.enabled;
        currentSession?.sendSystemCommand({
          kind: "lock-on-session-end-status",
          enabled: lockOnSessionEnd,
          ok: sessionPermissions.control,
        });
      } else if (cmd.kind === "quality-request") {
        await currentSession?.setVideoBitrate(QUALITY_BITRATE_KBPS[cmd.level]);
      } else if (cmd.kind === "block-input") {
        if (sessionPermissions.control) {
          const applied = await window.bromeo.blockInput(cmd.enabled);
          inputBlocked = cmd.enabled ? applied : false;
          currentSession?.sendSystemCommand({
            kind: "block-input-status",
            enabled: inputBlocked,
            ok: cmd.enabled ? applied : true,
          });
        }
      } else if (cmd.kind === "ctrl-alt-del-request") {
        if (sessionPermissions.control) {
          const ok = await window.bromeo.sendCtrlAltDel();
          const installed = ok || (await window.bromeo.sasStatus());
          currentSession?.sendSystemCommand({ kind: "ctrl-alt-del-status", ok, installed });
        }
      } else if (cmd.kind === "switch-monitor") {
        await window.bromeo.setActiveMonitor(cmd.monitorId);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: CAPTURE_VIDEO_CONSTRAINTS,
          audio: false,
        });
        await currentSession?.replaceVideoTrack(stream);
      } else if (cmd.kind === "window-list-request") {
        const windows = await window.bromeo.listWindows();
        currentSession?.sendSystemCommand({ kind: "window-list", windows });
      } else if (cmd.kind === "switch-window") {
        if (!sessionPermissions.control) return;
        await window.bromeo.setActiveWindow(cmd.windowId, cmd.aspect);
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: CAPTURE_VIDEO_CONSTRAINTS,
          audio: false,
        });
        await currentSession?.replaceVideoTrack(stream);
      } else if (cmd.kind === "resize-active-window") {
        if (sessionPermissions.control) await window.bromeo.resizeActiveWindow(cmd.aspect);
      } else if (cmd.kind === "switch-to-desktop") {
        if (!sessionPermissions.control) return;
        await window.bromeo.setCaptureDesktop();
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: CAPTURE_VIDEO_CONSTRAINTS,
          audio: false,
        });
        await currentSession?.replaceVideoTrack(stream);
      }
    },
    onFileOffer: (offer) => {
      if (!sessionPermissions.files) {
        toast(`Bestand geweigerd door sessierechten: ${offer.name}`);
        return false;
      }
      addFileRow(offer.id, offer.name);
    },
    onFileProgress: (id, received, total) => {
      if (sessionPermissions.files) updateFileRow(id, received, total);
    },
    onFileComplete: async (id, name, chunks) => {
      if (!sessionPermissions.files) return;
      const res = await window.bromeo.saveFile(name, chunks);
      filesTransferredCount++;
      finishFileRow(id, res.ok ? `Opgeslagen: ${res.path}` : "Opslaan geannuleerd");
    },
  });
}

function onHostConnectionState(peerId: string, state: RTCPeerConnectionState): void {
  if (state === "connected") {
    const action = sessionViewOnly ? "kijkt mee met" : "bekijkt en bestuurt";
    el.sharingText.textContent = `${formatId(peerId)} ${action} dit apparaat (${permissionsSummary(sessionPermissions)})`;
    el.sharingBar.classList.remove("hidden");
    el.curtainManualToggle.classList.remove("hidden");
    window.bromeo.listMonitors().then((monitors) => {
      if (monitors.length > 1) currentSession?.sendSystemCommand({ kind: "monitor-list", monitors });
    });
    if (curtainModeEnabled) {
      monitorIsOff = true;
      window.bromeo.setMonitorPower(false);
      el.curtainManualToggle.textContent = "Scherm aan";
    }
    const miniState = miniControllerState(peerId);
    if (miniState) window.bromeo.showMiniController(miniState);
  } else if (["disconnected", "failed", "closed"].includes(state)) {
    endSession();
  }
}

function handleConnectResponse(fromId: string, accept: boolean, reason?: string): void {
  if (accept) {
    maybeSaveDeviceAfterConnect(fromId);
    const permissions = lastConnectAttempt?.targetId === fromId ? lastConnectAttempt.permissions : defaultPermissions(false);
    startViewerSession(fromId, !permissions.control, permissions);
    return;
  }
  el.connectStatus.textContent = "";
  if (reason === "totp-required" || reason === "bad-totp") {
    el.totpRequiredMessage.textContent =
      reason === "bad-totp"
        ? "Onjuiste code. Voer de actuele 6-cijferige code uit de authenticator-app in."
        : "Dit apparaat gebruikt twee-factor-authenticatie. Voer de 6-cijferige code uit de authenticator-app in.";
    el.totpRequiredInput.value = "";
    el.totpRequiredModal.classList.remove("hidden");
    return;
  }
  const reasons: Record<string, string> = {
    offline: "Dat apparaat is niet online.",
    "bad-password": "Onjuist wachtwoord.",
    declined: "De partner heeft de aanvraag geweigerd.",
    "not-trusted": "Dit apparaat accepteert alleen opgeslagen apparaten.",
    busy: "De partner heeft al een actieve sessie.",
  };
  toast(reasons[reason ?? ""] ?? "Verbinding geweigerd.");
}

function startViewerSession(peerId: string, viewOnly: boolean, permissions = defaultPermissions(viewOnly)): void {
  currentRole = "viewer";
  currentPeerId = peerId;
  sessionReachedConnectedOnce = false;
  sessionPermissions = normalizePermissions(permissions, viewOnly);
  sessionViewOnly = !sessionPermissions.control;
  sessionStartedAt = Date.now();
  filesTransferredCount = 0;
  sessionWasRecorded = false;
  startSessionClock();
  startIdleTimer();
  el.sessionPeer.textContent = formatId(peerId);
  el.viewOnlyBadge.classList.toggle("hidden", !sessionViewOnly);
  el.textToggleBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.shortcutsToggleBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.restartBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.lockBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.lockOnEndBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.blockInputBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.ctrlAltDelBtn.classList.toggle("hidden", !sessionPermissions.control);
  el.clipboardBtn.classList.toggle("hidden", !sessionPermissions.clipboard);
  el.filesToggleBtn.classList.toggle("hidden", !sessionPermissions.files);
  // Reset to the default (unblocked) look for this fresh session — the
  // previous session's block-input state doesn't carry over.
  setBlockInputUi(false);
  setLockOnEndUi(false);
  updateSessionState("starting");
  el.sessionNotesInput.value = "";
  el.sessionStats.textContent = "Beeld wordt geladen";
  el.sessionHint.classList.remove("hidden");
  remoteAudioMuted = false;
  el.remoteVideo.muted = false;
  setIconButtonState(el.audioToggleBtn, "Geluid uit", "icon-volume-x");
  el.home.classList.add("hidden");
  el.sessionView.classList.remove("hidden");
  currentSession = new PeerSession("viewer", DEFAULT_ICE_SERVERS, signaling, peerId, {
    onRemoteStream: (stream) => {
      el.remoteVideo.srcObject = stream;
      el.sessionHint.classList.add("hidden");
      applyRemoteFitMode(el.fitModeSelect.value as RemoteFitMode);
      el.videoWrap.tabIndex = 0;
      el.videoWrap.focus();
      if (recordingMode === "auto") startRecording(true);
    },
    onConnectionState: (state) => {
      updateSessionState(state);
      if (state === "connected") sessionReachedConnectedOnce = true;
      if (["disconnected", "failed", "closed"].includes(state)) {
        // currentPeerId is already null by the time a *deliberate* hangup
        // (disconnect button, idle timeout, peer-initiated bye, ...) reaches
        // here, since endSession() clears it before pc.close() — so this
        // only fires for a genuine, unexpected drop of a session that was
        // actually connected. explicit restart-and-reconnect keeps its own
        // path via restartRequestedFor; this covers everything else (e.g.
        // the NAT-timeout-driven drop a direct P2P path can hit — see
        // docs/WEBRTC-TURN-DEBUGGING.md).
        const surpriseDrop = currentPeerId === peerId && sessionReachedConnectedOnce;
        const reconnectInfo =
          restartRequestedFor === peerId ? lastConnectAttempt : surpriseDrop && lastConnectAttempt?.targetId === peerId ? lastConnectAttempt : null;
        restartRequestedFor = null;
        endSession();
        if (reconnectInfo) scheduleAutoReconnect(reconnectInfo.targetId, reconnectInfo.passwordHash, reconnectInfo.viewOnly, reconnectInfo.permissions);
      }
    },
    onStats: (stats) => {
      el.sessionStats.textContent = formatSessionStats(stats);
    },
    onClipboard: async (text) => {
      if (!sessionPermissions.clipboard) {
        toast("Klembord ontvangen, maar geweigerd door sessierechten.");
        return;
      }
      await window.bromeo.setClipboard(text);
      toast(`Klembord ontvangen (${text.length} tekens).`);
    },
    onChatMessage: (text, timestamp) => receiveChatMessage(text, timestamp),
    onSystemCommand: (cmd) => {
      if (cmd.kind === "monitor-list") populateMonitorSelect(cmd.monitors);
      else if (cmd.kind === "block-input-status") {
        // `enabled` here is the host's actual resulting state (not an echo
        // of what we requested), so it's always safe to trust directly —
        // `ok` only controls whether we also surface a failure toast.
        setBlockInputUi(cmd.enabled, false);
        if (!cmd.ok) toast("Blokkeren van externe invoer is mislukt.");
      } else if (cmd.kind === "lock-on-session-end-status") {
        applyLockOnEndStatus(cmd.enabled, cmd.ok);
      } else if (cmd.kind === "ctrl-alt-del-status") {
        if (cmd.ok) toast("Ctrl+Alt+Del verzonden.");
        else if (!cmd.installed) toast("De host heeft Ctrl+Alt+Del op afstand niet ingeschakeld.");
        else toast("Versturen van Ctrl+Alt+Del is mislukt.");
      }
    },
    onFileOffer: (offer) => {
      if (!sessionPermissions.files) {
        toast(`Bestand geweigerd door sessierechten: ${offer.name}`);
        return false;
      }
      addFileRow(offer.id, offer.name);
    },
    onFileProgress: (id, received, total) => {
      if (sessionPermissions.files) updateFileRow(id, received, total);
    },
    onFileComplete: async (id, name, chunks) => {
      if (!sessionPermissions.files) return;
      const res = await window.bromeo.saveFile(name, chunks);
      filesTransferredCount++;
      finishFileRow(id, res.ok ? `Opgeslagen: ${res.path}` : "Opslaan geannuleerd");
    },
  });
  currentSession.startAsViewer();
  applyQualityLevel(el.qualitySelect.value as QualityLevel);
  el.connectStatus.textContent = "Verbonden.";
}

function handleSignal(fromId: string, payload: unknown): void {
  if (!currentSession) return;
  const p = payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  if (p.candidate) {
    currentSession.addRemoteCandidate(p.candidate);
    return;
  }
  if (p.sdp?.type === "offer" && currentRole === "host") {
    captureAndAnswer(p.sdp);
  } else if (p.sdp?.type === "answer" && currentRole === "viewer") {
    currentSession.applyAnswer(p.sdp);
  }
}

async function captureAndAnswer(offer: RTCSessionDescriptionInit): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: CAPTURE_VIDEO_CONSTRAINTS,
      // System audio via Electron's loopback capture (see setupDisplayMediaHandler
      // in main.ts) — falls back to silent video-only if the OS/session can't
      // supply a loopback track, getDisplayMedia doesn't reject for that.
      audio: true,
    });
    await currentSession?.acceptAsHost(offer, stream);
  } catch (err) {
    toast("Kon het scherm niet delen: " + (err as Error).message);
    endSession();
  }
}

function endSession(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
  window.bromeo.hideMiniController();
  showSessionSummary();
  stopSessionClock();
  stopIdleTimer();
  clearIncomingTimeout();
  pendingIncoming = null;
  el.incomingModal.classList.add("hidden");
  if (monitorIsOff) {
    window.bromeo.setMonitorPower(true);
    monitorIsOff = false;
  }
  // Safety net: never leave the host's own mouse/keyboard blocked once a
  // session ends, however it ends (deliberate hangup, dropped connection,
  // ICE failure, ...) — see the "block-input" case in onSystemCommand above.
  if (inputBlocked) {
    window.bromeo.blockInput(false);
    inputBlocked = false;
  }
  if (currentRole === "host" && lockOnSessionEnd && !sessionViewOnly) {
    window.bromeo.lockComputer();
  }
  lockOnSessionEnd = false;
  el.curtainManualToggle.classList.add("hidden");
  el.curtainManualToggle.textContent = "Scherm uit";

  // Notify the peer immediately rather than letting it wait out a WebRTC
  // ICE-failure timeout (which can take many seconds) to notice we're gone.
  if (currentPeerId) signaling.send({ type: "bye", targetId: currentPeerId });
  currentPeerId = null;

  currentSession?.close();
  currentSession = null;
  currentRole = null;
  sessionPermissions = defaultPermissions(false);
  sessionViewOnly = false;
  el.sharingBar.classList.add("hidden");
  el.sessionView.classList.add("hidden");
  el.viewOnlyBadge.classList.add("hidden");
  el.home.classList.remove("hidden");
  el.filesPanel.classList.add("hidden");
  el.filesList.innerHTML = "";
  el.textPanel.classList.add("hidden");
  el.shortcutsPanel.classList.add("hidden");
  el.notesPanel.classList.add("hidden");
  el.remoteTextInput.value = "";
  el.sessionNotesInput.value = "";
  el.textToggleBtn.classList.remove("hidden");
  el.shortcutsToggleBtn.classList.remove("hidden");
  setBlockInputUi(false);
  setLockOnEndUi(false);
  el.connectStatus.textContent = "";
  el.remoteVideo.srcObject = null;
  el.remoteVideo.muted = false;
  remoteAudioMuted = false;
  setIconButtonState(el.audioToggleBtn, "Geluid uit", "icon-volume-x");
  el.sessionStats.textContent = "Beeld wordt geladen";
  updateSessionState("starting");
  el.sessionHint.classList.remove("hidden");
  chatLog = [];
  el.chatPanel.classList.add("hidden");
  el.hostChatPanel.classList.add("hidden");
  el.chatMessages.innerHTML = '<p class="muted small">Nog geen berichten.</p>';
  el.hostChatMessages.innerHTML = '<p class="muted small">Nog geen berichten.</p>';
  el.chatInput.value = "";
  el.hostChatInput.value = "";
  aiBuddyLog = [];
  clearAiBuddyScreenshot();
  el.aiBuddyPanel.classList.add("hidden");
  renderAiBuddyMessages();
  el.restartConfirmModal.classList.add("hidden");
  el.monitorSelect.innerHTML = "";
  el.monitorSelect.classList.add("hidden");
}

function startSessionClock(): void {
  if (sessionDurationHandle) clearInterval(sessionDurationHandle);
  updateSessionDuration();
  sessionDurationHandle = setInterval(updateSessionDuration, 1000);
}

function stopSessionClock(): void {
  if (sessionDurationHandle) clearInterval(sessionDurationHandle);
  sessionDurationHandle = null;
  el.sessionDuration.textContent = "00:00";
}

function updateSessionDuration(): void {
  if (sessionStartedAt == null) {
    el.sessionDuration.textContent = "00:00";
    return;
  }
  const totalSeconds = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    el.sessionDuration.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  } else {
    el.sessionDuration.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
}

function showSessionSummary(): void {
  if (sessionStartedAt == null || !currentPeerId || !currentRole) return;
  const durationSec = Math.round((Date.now() - sessionStartedAt) / 1000);
  const endedAt = Date.now();
  const durationText = formatDuration(durationSec);
  const filesText = filesTransferredCount === 0 ? "geen bestanden overgezet" : `${filesTransferredCount} bestand(en) overgezet`;
  saveSessionHistoryEntry({
    id: crypto.randomUUID(),
    peerId: currentPeerId,
    role: currentRole,
    startedAt: sessionStartedAt,
    endedAt,
    durationSec,
    viewOnly: sessionViewOnly,
    permissions: sessionPermissions,
    filesTransferred: filesTransferredCount,
    note: el.sessionNotesInput.value.trim(),
    recorded: sessionWasRecorded,
  });
  toast(`Sessie beëindigd — duurde ${durationText}, ${filesText}.`);
  sessionStartedAt = null;
  filesTransferredCount = 0;
}

// --- Session recording (viewer side, records the remote screen you're seeing) ---

function toggleRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
  else startRecording();
}

function startRecording(auto = false): void {
  const stream = el.remoteVideo.srcObject as MediaStream | null;
  if (!stream || currentRole !== "viewer") {
    if (!auto) toast("Kan alleen opnemen tijdens een actieve sessie.");
    return;
  }
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const suggestedName = `BromeoRemote-opname-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    const res = await window.bromeo.saveRecording(buffer, suggestedName);
    toast(res.ok ? `Opname opgeslagen: ${res.path}` : "Opslaan van opname geannuleerd.");
  };
  mediaRecorder.start();
  sessionWasRecorded = true;
  recordingStartedAt = Date.now();
  setIconButtonState(el.recordToggleBtn, "Stop opname", "icon-stop");
  el.recordingIndicator.classList.remove("hidden");
  recordingTimerHandle = setInterval(updateRecordingTimer, 1000);
  updateRecordingTimer();
  if (auto) toast("Automatische opname gestart.");
}

function stopRecording(): void {
  mediaRecorder?.stop();
  mediaRecorder = null;
  if (recordingTimerHandle) clearInterval(recordingTimerHandle);
  recordingTimerHandle = null;
  setIconButtonState(el.recordToggleBtn, "Opnemen", "icon-record");
  el.recordingIndicator.classList.add("hidden");
}

function updateRecordingTimer(): void {
  const elapsedSec = Math.floor((Date.now() - recordingStartedAt) / 1000);
  const minutes = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const seconds = String(elapsedSec % 60).padStart(2, "0");
  el.recordingTime.textContent = `${minutes}:${seconds}`;
}

// --- In-session chat ---

function sendChatMessage(inputEl: HTMLInputElement): void {
  const text = inputEl.value.trim();
  if (!text || !currentSession) return;
  currentSession.sendChat(text);
  chatLog.push({ text, timestamp: Date.now(), mine: true });
  renderChat();
  inputEl.value = "";
}

function receiveChatMessage(text: string, timestamp: number): void {
  chatLog.push({ text, timestamp, mine: false });
  renderChat();
  const panel = currentRole === "host" ? el.hostChatPanel : el.chatPanel;
  if (panel.classList.contains("hidden")) toast("Nieuw chatbericht ontvangen.");
}

function renderChat(): void {
  const container = currentRole === "host" ? el.hostChatMessages : el.chatMessages;
  if (chatLog.length === 0) {
    container.innerHTML = '<p class="muted small">Nog geen berichten.</p>';
    return;
  }
  container.innerHTML = chatLog
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      return `<div class="chat-bubble ${m.mine ? "chat-bubble--mine" : ""}">${escapeHtml(m.text)}<span class="chat-bubble-time">${time}</span></div>`;
    })
    .join("");
  container.scrollTop = container.scrollHeight;
}

// --- AI Buddy (local-only — the user's own OpenAI key, never touches the
// signaling server) ---

// Snapshots the current remote-session <video> frame via an offscreen
// canvas — a real DOM element, trivial to draw and export unlike mobile's
// native SurfaceView-backed RTCView (see mobile/src/aiBuddy.ts's PixelCopy
// native module for that side of the story).
function captureRemoteVideoFrame(): string | null {
  const video = el.remoteVideo;
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = el.aiBuddyCaptureCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function setAiBuddyScreenshot(dataUrl: string): void {
  aiBuddyPendingScreenshot = dataUrl;
  el.aiBuddyScreenshotImg.src = dataUrl;
  el.aiBuddyScreenshotPreview.classList.remove("hidden");
}

function clearAiBuddyScreenshot(): void {
  aiBuddyPendingScreenshot = null;
  el.aiBuddyScreenshotImg.src = "";
  el.aiBuddyScreenshotPreview.classList.add("hidden");
}

function renderAiBuddyMessages(): void {
  if (aiBuddyLog.length === 0) {
    el.aiBuddyMessages.innerHTML =
      '<p class="muted small">Maak een screenshot van het scherm op afstand en stel een vraag — AI Buddy helpt je stap voor stap.</p>';
    return;
  }
  el.aiBuddyMessages.innerHTML = aiBuddyLog
    .map((m) => {
      const imageHtml = m.imageBase64 ? `<div class="chat-bubble--ai-buddy-image"><img src="${m.imageBase64}" alt="Screenshot" /></div>` : "";
      return `<div class="chat-bubble ${m.role === "user" ? "chat-bubble--mine" : ""}">${imageHtml}${escapeHtml(m.text)}</div>`;
    })
    .join("");
  el.aiBuddyMessages.scrollTop = el.aiBuddyMessages.scrollHeight;
}

async function sendAiBuddyMessage(): Promise<void> {
  const text = el.aiBuddyInput.value.trim();
  if (!text || aiBuddySending) return;
  if (!(await window.bromeo.getOpenAiKeyStatus())) {
    toast("Stel eerst je OpenAI API-sleutel in bij de AI Buddy-instellingen.");
    return;
  }
  const imageBase64 = aiBuddyPendingScreenshot ?? undefined;
  aiBuddyLog.push({ role: "user", text, imageBase64, timestamp: Date.now() });
  el.aiBuddyInput.value = "";
  clearAiBuddyScreenshot();
  renderAiBuddyMessages();

  aiBuddySending = true;
  el.aiBuddySendBtn.disabled = true;
  el.aiBuddyStatus.textContent = "AI Buddy denkt na…";
  try {
    const history = aiBuddyLog.map((m) => ({ role: m.role, text: m.text, imageBase64: m.imageBase64 }));
    const result = await window.bromeo.askAiBuddy(history);
    aiBuddyLog.push({
      role: "assistant",
      text: result.ok && result.reply ? result.reply : `⚠️ ${result.error ?? "Onbekende fout."}`,
      timestamp: Date.now(),
    });
  } catch (err) {
    aiBuddyLog.push({ role: "assistant", text: `⚠️ ${(err as Error).message}`, timestamp: Date.now() });
  } finally {
    aiBuddySending = false;
    el.aiBuddySendBtn.disabled = false;
    el.aiBuddyStatus.textContent = "";
    renderAiBuddyMessages();
  }
}

// --- Multi-monitor switching (viewer side) ---

function populateMonitorSelect(monitors: MonitorInfo[]): void {
  el.monitorSelect.innerHTML = monitors.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
  el.monitorSelect.classList.toggle("hidden", monitors.length <= 1);
}

// --- File transfer UI rows ---

function addFileRow(id: string, name: string): void {
  const row = document.createElement("div");
  row.className = "file-row";
  row.id = `file-${id}`;
  row.innerHTML = `<div>${name}</div><progress value="0" max="100"></progress>`;
  el.filesList.prepend(row);
  el.filesPanel.classList.remove("hidden");
}

function updateFileRow(id: string, received: number, total: number): void {
  const row = document.getElementById(`file-${id}`);
  const bar = row?.querySelector("progress");
  if (bar) bar.value = total > 0 ? Math.round((received / total) * 100) : 0;
}

function finishFileRow(id: string, statusText: string): void {
  const row = document.getElementById(`file-${id}`);
  if (row) row.innerHTML += `<div class="muted small">${statusText}</div>`;
}

// --- Remote control input capture (viewer role) ---

function wireRemoteControlCapture(): void {
  const wrap = el.videoWrap;

  wrap.addEventListener("mousemove", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mousemove", xPct, yPct });
  });
  wrap.addEventListener("mousedown", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    wrap.focus();
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mousedown", button: buttonName(e.button), xPct, yPct });
  });
  wrap.addEventListener("mouseup", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    const { xPct, yPct } = toPct(e);
    currentSession.sendInput({ kind: "mouseup", button: buttonName(e.button), xPct, yPct });
  });
  wrap.addEventListener("wheel", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "wheel", deltaX: e.deltaX, deltaY: e.deltaY });
  }, { passive: false });
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());

  wrap.addEventListener("keydown", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "keydown", key: e.key, code: e.code });
  });
  wrap.addEventListener("keyup", (e) => {
    if (currentRole !== "viewer" || !currentSession || sessionViewOnly) return;
    e.preventDefault();
    currentSession.sendInput({ kind: "keyup", key: e.key, code: e.code });
  });

  function toPct(e: MouseEvent): { xPct: number; yPct: number } {
    const rect = el.remoteVideo.getBoundingClientRect();
    const xPct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const yPct = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { xPct, yPct };
  }

  function buttonName(button: number): "left" | "right" | "middle" {
    if (button === 2) return "right";
    if (button === 1) return "middle";
    return "left";
  }
}

init().catch((err) => console.error("init failed", err));
