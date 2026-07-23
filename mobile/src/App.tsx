import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  PanResponder,
  StatusBar,
  Image,
  AppState,
  ActivityIndicator,
  Alert,
  Switch,
  Dimensions,
  Keyboard as RNKeyboard,
} from "react-native";
// react-native's own SafeAreaView is effectively iOS-only in practice (a
// no-op on Android) — this one actually insets for the status bar/notch on
// both platforms, via the SafeAreaProvider wrapping <App/> in index.js.
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RTCView, MediaStream, mediaDevices } from "react-native-webrtc";
import { DEFAULT_SIGNALING_URL, DEFAULT_ICE_SERVERS } from "./shared/config";
import type { MonitorInfo, NotificationPayload, QualityLevel, SavedDevice, ServerMessage, WindowInfo } from "./shared/protocol";
import { sha256Hex } from "./crypto";
import { Signaling } from "./signaling";
import { MobileSession } from "./session";
import { requestNotificationPermission, getPushToken, onPushTokenRefresh, onForegroundPush } from "./push";
import { ensureNotificationChannels, onNotificationPress, getInitialNotificationPress, openConfirmNotificationSettings } from "./notifications";
import { getOpenAiApiKey, setOpenAiApiKey, captureRemoteVideoFrame, askAiBuddy, type AiBuddyMessage } from "./aiBuddy";
import { isAccessibilityServiceEnabled, openAccessibilitySettings } from "./remoteControl";
import { RemoteInputTranslator } from "./inputTranslator";
import { getSavedDevices, saveDevice, removeSavedDevice, toggleFavorite, sortSavedDevices } from "./savedDevices";
import { pick, isErrorWithCode, errorCodes } from "@react-native-documents/picker";
import ReactNativeBlobUtil from "react-native-blob-util";
import { TapGestureIcon, LongPressGestureIcon, DragGestureIcon, LongPressDragGestureIcon, PinchGestureIcon } from "./gestureIcons";
import {
  AppWindow,
  ArrowUpDown,
  Ban,
  Camera,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Folder,
  Hand,
  Keyboard,
  Lock,
  MessageCircle,
  Move,
  MousePointer2,
  MousePointerClick,
  Power,
  RotateCw,
  Save,
  Settings,
  Sparkles,
  Star,
  Timer,
  Trash2,
  X,
  Zap,
  ZoomIn,
} from "lucide-react-native";

const logo2 = require("./assets/logo2.png");

const DEVICE_ID_KEY = "bromeoremote_device_id";
const QUALITY_LEVEL_KEY = "bromeoremote_quality_level";
const SHOW_CURSOR_KEY = "bromeoremote_show_remote_cursor";
const THEME_KEY = "bromeoremote_theme";

// Mirrors the actual gesture handling in the panResponder below exactly —
// keep in sync if that logic changes.
const MOUSE_MODE_GESTURES = [
  { Icon: MousePointerClick, title: "Tikken", desc: "Klikken (links)" },
  { Icon: Timer, title: "Lang indrukken", desc: "Rechtsklikken" },
  { Icon: Move, title: "Slepen", desc: "Muis verplaatsen" },
  { Icon: MousePointerClick, title: "Dubbeltikken + slepen", desc: "Klik-en-sleep om te selecteren" },
  { Icon: ArrowUpDown, title: "3 vingers slepen", desc: "Scrollen" },
  { Icon: ZoomIn, title: "Knijpen", desc: "In-/uitzoomen (alleen op je scherm)" },
] as const;
const TOUCH_MODE_GESTURES = [
  { Icon: TapGestureIcon, title: "Tikken", desc: "Klikken op die plek" },
  { Icon: LongPressGestureIcon, title: "Lang indrukken", desc: "Rechtsklikken op die plek" },
  { Icon: DragGestureIcon, title: "Snel slepen", desc: "Scrollen" },
  { Icon: LongPressDragGestureIcon, title: "Lang indrukken + slepen", desc: "Selecteren" },
  { Icon: PinchGestureIcon, title: "Dubbeltikken of knijpen", desc: "In-/uitzoomen (alleen op je scherm)" },
] as const;

type AppTheme = "light" | "dark";
type IconComponent = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

const themeColors = {
  light: {
    bg: "#f4f7fb",
    card: "#ffffff",
    field: "#eef3fb",
    border: "#d8e2f1",
    text: "#071a35",
    muted: "#53627c",
    primary: "#2f6fed",
    danger: "#e5484d",
    ok: "#118a58",
    bad: "#c82f45",
    codeBg: "#f0f4fb",
    overlayBg: "rgba(255,255,255,0.92)",
    overlayBorder: "rgba(216,226,241,0.92)",
    toolbarButton: "#253352",
    toolbarButtonText: "#ffffff",
    segmentBg: "#e8eef8",
    segmentText: "#071a35",
    toastBg: "rgba(7,22,51,0.94)",
    bubbleMine: "#dbeafe",
    bubbleTheirs: "#eef3fb",
    bubbleText: "#071a35",
    switchOff: "#c8d3e5",
  },
  dark: {
    bg: "#0b1220",
    card: "#16213a",
    field: "#0b1220",
    border: "#253352",
    text: "#ffffff",
    muted: "#8b96b8",
    primary: "#3b7bfd",
    danger: "#e5484d",
    ok: "#34c78e",
    bad: "#e5484d",
    codeBg: "#16213a",
    overlayBg: "rgba(22, 33, 58, 0.9)",
    overlayBorder: "rgba(37, 51, 82, 0.9)",
    toolbarButton: "#253352",
    toolbarButtonText: "#ffffff",
    segmentBg: "#0b1220",
    segmentText: "#ffffff",
    toastBg: "rgba(22, 33, 58, 0.95)",
    bubbleMine: "#3b7bfd",
    bubbleTheirs: "#253352",
    bubbleText: "#ffffff",
    switchOff: "#253352",
  },
} as const;

interface NotifyEntry extends NotificationPayload {
  replyTo?: string;
  status?: "allow" | "deny";
}

function randomDeviceId(): string {
  const first = 1 + Math.floor(Math.random() * 9);
  let rest = "";
  for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
  return `${first}${rest}`;
}

function formatId(id: string): string {
  return id.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

// Mirrors client/src/renderer/app.ts's formatDuration exactly (same wording).
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds}s` : `${seconds}s`;
}

// Regenerated fresh each app launch — mirrors client/src/main/store.ts's
// rotating session password for the desktop's "unattended" toggle counterpart.
function randomPassword(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function App(): React.JSX.Element {
  // SafeAreaView only pads elements laid out in normal flow — the session
  // toolbar deliberately floats over the video with position:"absolute" (see
  // floatingToolbarWrap), which bypasses that padding entirely and let it
  // sit right under the phone's own gesture/button navigation area. Applied
  // directly to that container's `bottom` below.
  const insets = useSafeAreaInsets();
  const [theme, setThemeState] = useState<AppTheme>("light");
  const colors = themeColors[theme];
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [myId, setMyId] = useState("");
  const [serverStatus, setServerStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [targetId, setTargetId] = useState("");
  const [targetPassword, setTargetPassword] = useState("");
  const [connectStatus, setConnectStatus] = useState("");
  // Lightweight non-blocking status feedback (e.g. "Vergrendelen
  // aangevraagd.") — distinct from Alert.alert, which stays reserved for
  // failures that genuinely need the user to notice and dismiss.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string): void {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500);
  }
  const [savedDevices, setSavedDevicesState] = useState<SavedDevice[]>([]);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [rememberLabel, setRememberLabel] = useState("");
  // Carries what we just tried to connect to from the request through to the
  // connect-response handler, so a successful "remember" save has the right
  // hash/label/id without threading them through the server round-trip.
  const pendingConnectRef = useRef<{ targetId: string; passwordHash: string; remember: boolean; label: string } | null>(null);
  // Unlike pendingConnectRef (cleared once the connect-response resolves),
  // this stays set for the life of the session — needed to retry with a TOTP
  // code, and to auto-reconnect after a restart request.
  const lastConnectRef = useRef<{ targetId: string; passwordHash: string } | null>(null);
  const restartRequestedForRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  // Gates auto-reconnect to sessions that actually connected at least once —
  // an initial attempt that never got off the ground shouldn't retry-loop.
  const sessionReachedConnectedOnceRef = useRef(false);
  const filesTransferredCountRef = useRef(0);
  const [totpRequired, setTotpRequired] = useState<"totp-required" | "bad-totp" | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [activeMonitorId, setActiveMonitorId] = useState<string | null>(null);
  const [inSession, setInSession] = useState(false);
  const [sessionPeer, setSessionPeer] = useState("");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [statsText, setStatsText] = useState("");
  const [notifications, setNotifications] = useState<NotifyEntry[]>([]);
  const [activeConfirm, setActiveConfirm] = useState<NotifyEntry | null>(null);
  // Phone-as-host: a pc can view/control THIS phone the same way this app
  // views other pcs. Session password (not persisted — regenerated on every
  // launch, mirrors the desktop's rotating password) gates who can even
  // trigger the accept/decline dialog below.
  const [hostSessionPassword] = useState(() => randomPassword());
  const [pendingIncoming, setPendingIncoming] = useState<{ fromId: string } | null>(null);
  const [currentRole, setCurrentRoleState] = useState<"viewer" | "host" | null>(null);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const roleRef = useRef<"viewer" | "host" | null>(null);
  function setCurrentRole(role: "viewer" | "host" | null): void {
    roleRef.current = role;
    setCurrentRoleState(role);
  }
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Tracks the actual OS keyboard height so the video area can shift up
  // above it (see the keyboardHeight usage below) instead of the keyboard
  // simply covering whatever was at the bottom of the screen.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = RNKeyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = RNKeyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  // The hidden keyboard-bridge TextInput's own controlled value — always
  // reset to "" right after each keystroke is forwarded. Previously this
  // field was uncontrolled and cleared via an imperative .clear() call,
  // which is an async native command with no relation to React's own state:
  // typing quickly could fire another onChangeText before that clear() had
  // actually landed, so the "new" text each time was really the old text
  // plus the new character(s) again, sending overlapping/duplicated
  // characters (exactly the scrambled repeats reported when typing fast). A
  // controlled input makes "" the authoritative value immediately.
  const [keyboardDraft, setKeyboardDraft] = useState("");
  // Only one of the toolbar's dropdown panels is open at a time (Shortcuts,
  // Quick actions, Settings) — matches TeamViewer's mobile session bar.
  const [activePanel, setActivePanel] = useState<"quickActions" | "settings" | "chat" | "files" | "programs" | "aiBuddy" | "interactionHelp" | null>(null);
  // "Control a program" — pick one of the host's open windows, view/control
  // just that window (resized on the host to match this phone's aspect
  // ratio), instead of the whole desktop.
  const [windowList, setWindowList] = useState<WindowInfo[]>([]);
  const [activeAppWindow, setActiveAppWindow] = useState<{ id: string; name: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<{ text: string; timestamp: number; fromMe: boolean }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);
  function receiveChatMessage(text: string, timestamp: number): void {
    setChatMessages((prev) => [...prev, { text, timestamp, fromMe: false }]);
    setHasUnreadChat(true);
  }
  function sendChatMessage(): void {
    const text = chatInput.trim();
    if (!text) return;
    sessionRef.current?.sendChat(text);
    setChatMessages((prev) => [...prev, { text, timestamp: Date.now(), fromMe: true }]);
    setChatInput("");
  }
  function openChat(): void {
    setHasUnreadChat(false);
    setActivePanel((p) => (p === "chat" ? null : "chat"));
  }

  // --- AI Buddy (local-only — this device's own OpenAI key, never touches
  // the signaling server) ---
  const [aiBuddyLog, setAiBuddyLog] = useState<{ role: "user" | "assistant"; text: string; imageBase64?: string; timestamp: number }[]>([]);
  const [aiBuddyInput, setAiBuddyInput] = useState("");
  const [aiBuddyScreenshot, setAiBuddyScreenshot] = useState<string | null>(null);
  const [aiBuddySending, setAiBuddySending] = useState(false);
  const [openaiKeyConfigured, setOpenaiKeyConfigured] = useState(false);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const aiBuddyScrollRef = useRef<ScrollView>(null);

  async function saveOpenAiKey(): Promise<void> {
    const key = openaiKeyInput.trim();
    await setOpenAiApiKey(key || null);
    setOpenaiKeyConfigured(!!key);
    setOpenaiKeyInput("");
    showToast(key ? "OpenAI-sleutel opgeslagen." : "OpenAI-sleutel verwijderd.");
  }

  async function takeAiBuddyScreenshot(): Promise<void> {
    const frame = await captureRemoteVideoFrame(rtcViewRef);
    if (!frame) {
      showToast("Kon geen screenshot maken — is het beeld al geladen?");
      return;
    }
    setAiBuddyScreenshot(frame);
  }

  async function sendAiBuddyMessage(): Promise<void> {
    const text = aiBuddyInput.trim();
    if (!text || aiBuddySending) return;
    if (!(await getOpenAiApiKey())) {
      showToast("Stel eerst je OpenAI API-sleutel in bij Instellingen.");
      return;
    }
    const imageBase64 = aiBuddyScreenshot ?? undefined;
    const nextLog = [...aiBuddyLog, { role: "user" as const, text, imageBase64, timestamp: Date.now() }];
    setAiBuddyLog(nextLog);
    setAiBuddyInput("");
    setAiBuddyScreenshot(null);
    setAiBuddySending(true);
    try {
      const history: AiBuddyMessage[] = nextLog.map((m) => ({ role: m.role, text: m.text, imageBase64: m.imageBase64 }));
      const result = await askAiBuddy(history);
      setAiBuddyLog((prev) => [
        ...prev,
        { role: "assistant", text: result.ok && result.reply ? result.reply : `⚠️ ${result.error ?? "Onbekende fout."}`, timestamp: Date.now() },
      ]);
    } catch (err) {
      setAiBuddyLog((prev) => [...prev, { role: "assistant", text: `⚠️ ${(err as Error).message}`, timestamp: Date.now() }]);
    } finally {
      setAiBuddySending(false);
    }
  }

  function applyTheme(next: AppTheme): void {
    setThemeState(next);
    AsyncStorage.setItem(THEME_KEY, next).catch(() => undefined);
  }

  function renderThemeToggle(): React.JSX.Element {
    return (
      <View style={styles.modeToggle}>
        {(["light", "dark"] as AppTheme[]).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.modeToggleBtn, theme === value && styles.modeToggleBtnActive]}
            onPress={() => applyTheme(value)}
          >
            <Text style={[styles.settingsQualityText, theme === value && styles.settingsQualityTextActive]}>
              {value === "light" ? "Licht" : "Donker"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // Icon-only toolbar buttons read as unclear/generic — pairing every icon
  // with a short label is standard practice (iOS tab bars, Material Design
  // bottom app bars) precisely because icons alone are rarely self-
  // explanatory at a glance, even well-drawn ones.
  function toolbarIcon(Icon: IconComponent, label?: string, active = false, danger = false): React.JSX.Element {
    // Flat dark-blue icon by default (no background pill) — white only
    // when its panel is actually open (toolbarBtnActive's filled pill) or
    // for the permanently-red disconnect button (dangerBtn's own background).
    return (
      <>
        <Icon size={18} color={active || danger ? "#fff" : colors.toolbarButton} strokeWidth={2.35} />
        {label && <Text style={[styles.toolbarBtnLabel, (active || danger) && styles.toolbarBtnLabelActive]}>{label}</Text>}
      </>
    );
  }

  function modeIcon(Icon: IconComponent, label: string, active: boolean): React.JSX.Element {
    return (
      <>
        <Icon size={18} color={active ? "#fff" : colors.segmentText} strokeWidth={2.25} />
        <Text style={[styles.modeToggleBtnLabel, active && styles.modeToggleBtnLabelActive]}>{label}</Text>
      </>
    );
  }


  interface FileTransfer {
    id: string;
    name: string;
    total: number;
    received: number;
    direction: "send" | "receive";
    done: boolean;
    savedPath?: string;
  }
  const [fileTransfers, setFileTransfers] = useState<FileTransfer[]>([]);

  function handleFileOffer(offer: { id: string; name: string; size: number }): void {
    setFileTransfers((prev) => [...prev, { id: offer.id, name: offer.name, total: offer.size, received: 0, direction: "receive", done: false }]);
  }
  function handleFileProgress(id: string, received: number, total: number): void {
    setFileTransfers((prev) => prev.map((f) => (f.id === id ? { ...f, received, total } : f)));
  }
  async function handleFileComplete(id: string, name: string, base64Chunks: string[]): Promise<void> {
    try {
      const base64 = base64Chunks.join("");
      const dest = `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/${name}`;
      await ReactNativeBlobUtil.fs.writeFile(dest, base64, "base64");
      // Makes the file show up immediately in Downloads/gallery apps instead
      // of only after the next full media-store rescan.
      await ReactNativeBlobUtil.fs.scanFile([{ path: dest, mime: "" }]).catch(() => undefined);
      setFileTransfers((prev) => prev.map((f) => (f.id === id ? { ...f, done: true, savedPath: dest } : f)));
      filesTransferredCountRef.current++;
      showToast(`Ontvangen: ${name} (opgeslagen in Downloads)`);
    } catch {
      setFileTransfers((prev) => prev.filter((f) => f.id !== id));
      Alert.alert("Mislukt", `"${name}" kon niet worden opgeslagen.`);
    }
  }

  async function sendFilePress(): Promise<void> {
    if (!sessionRef.current) return;
    let picked: { uri: string; name: string | null; size: number | null }[];
    try {
      picked = await pick({ mode: "open" });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert("Mislukt", "Kon geen bestand kiezen.");
      return;
    }
    const doc = picked[0];
    const name = doc.name ?? "bestand";
    const id = `${Date.now()}-out`;
    try {
      const base64: string = await ReactNativeBlobUtil.fs.readFile(doc.uri, "base64");
      setFileTransfers((prev) => [...prev, { id, name, total: doc.size ?? 0, received: doc.size ?? 0, direction: "send", done: false }]);
      await sessionRef.current.sendFile(name, base64);
      setFileTransfers((prev) => prev.map((f) => (f.id === id ? { ...f, done: true } : f)));
      filesTransferredCountRef.current++;
      showToast(`Verzonden: ${name}`);
    } catch {
      setFileTransfers((prev) => prev.filter((f) => f.id !== id));
      Alert.alert("Mislukt", `"${name}" kon niet worden verstuurd.`);
    }
  }
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  // Persisted across launches (see the AsyncStorage load effect below) — the
  // desktop client persists the same two settings to localStorage.
  const [showRemoteCursor, setShowRemoteCursorState] = useState(true);
  function setShowRemoteCursor(next: boolean): void {
    setShowRemoteCursorState(next);
    AsyncStorage.setItem(SHOW_CURSOR_KEY, next ? "1" : "0").catch(() => undefined);
  }
  const [inputBlocked, setInputBlocked] = useState(false);
  const [wallpaperHidden, setWallpaperHidden] = useState(false);
  const [qualityLevel, setQualityLevelState] = useState<QualityLevel>("auto");
  function setQualityLevel(level: QualityLevel): void {
    setQualityLevelState(level);
    AsyncStorage.setItem(QUALITY_LEVEL_KEY, level).catch(() => undefined);
    sessionRef.current?.sendSystemCommand({ kind: "quality-request", level });
  }

  // Branded loading screen shown while the initial signaling connection
  // resolves, so the native splash (LaunchTheme/launch_screen.xml) hands off
  // to something equally polished instead of a bare connect form appearing
  // mid-render. Bounded on both ends: a minimum so it never just flashes, and
  // a maximum so a slow/hung network doesn't strand the user on it forever.
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [maxSplashElapsed, setMaxSplashElapsed] = useState(false);
  useEffect(() => {
    const minTimer = setTimeout(() => setMinSplashElapsed(true), 600);
    const maxTimer = setTimeout(() => setMaxSplashElapsed(true), 4000);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);
  const booting = !maxSplashElapsed && (!minSplashElapsed || serverStatus === "connecting");

  const signalingRef = useRef<Signaling | null>(null);
  const sessionRef = useRef<MobileSession | null>(null);
  const confirmQueueRef = useRef<NotifyEntry[]>([]);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  // PanResponder.create() runs once inside useRef, so its handlers close over
  // whatever this was AT THAT TIME forever — a ref (not useState) is required
  // so sendMouseAt always reads the current layout instead of a stale {0,0}.
  // Stores the full page-absolute rect: locationX/Y from touch events land on
  // whichever native view is directly under the finger (e.g. RTCView instead
  // of the wrapping panHandler View under the new architecture), so mapping
  // uses pageX/Y minus this known origin instead.
  const videoLayoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  // The actual decoded frame's resolution (from RTCView's onDimensionsChange)
  // — needed to work out where objectFit="contain" letterbox/pillarbox bars
  // fall, since the video's aspect ratio rarely exactly matches the
  // container's. Without this, tap/cursor percentage math silently assumed
  // the video filled 100% of videoLayoutRef, which is only true when the
  // aspect ratios happen to match — otherwise every mapped point was off by
  // the letterbox offset, which is exactly why the mouse-mode cursor dot and
  // the real remote cursor (baked into the video) landed in different spots.
  const videoDimsRef = useRef({ width: 0, height: 0 });
  const videoWrapRef = useRef<View>(null);
  // Whichever RTCView branch is currently mounted (see the three render
  // branches below) — needed so AI Buddy's screenshot button can resolve
  // the native view by tag for PixelCopy capture (see aiBuddy.ts). `any`
  // matches this codebase's established pattern for react-native-webrtc's
  // own imprecise typings (see session.ts).
  const rtcViewRef = useRef<any>(null);
  const keyboardInputRef = useRef<TextInput>(null);
  const lastTouchRef = useRef<{ x: number; y: number; time: number; moved: boolean }>({ x: 0, y: 0, time: 0, moved: false });

  // Pinch-to-zoom on the video (visual only — the touch→mouse mapping below
  // inverts this transform so clicks stay accurate while zoomed in).
  const [zoom, setZoomState] = useState({ scale: 1, panX: 0, panY: 0 });
  // Mirrors `zoom` for reading inside the PanResponder closures below, which
  // (like videoLayoutRef) are created once and would otherwise see a stale value.
  const zoomRef = useRef(zoom);
  function setZoom(next: { scale: number; panX: number; panY: number }): void {
    zoomRef.current = next;
    setZoomState(next);
  }
  // True for the duration of an active 2-finger pinch. Resizing RTCView's
  // real layout (below) makes Android reallocate the native SurfaceView's
  // render buffer — far heavier than a transform, and firing that on every
  // pinch-move touch event is what caused the reported lag/overshoot/
  // disappearing. So: cheap transform-scale while fingers are actively
  // moving (a pinch in motion doesn't need pixel-perfect sharpness), then
  // switch to the real resize once the gesture settles, which is when it
  // actually matters for reading text.
  const [zoomLive, setZoomLive] = useState(false);
  // Zooming only magnifies the already-decoded frame (see the RTCView
  // transform below) — it doesn't reveal more real detail unless the
  // encoder was already spending enough bits to have that detail there in
  // the first place. So while zoomed in, temporarily ask the host for its
  // highest quality tier; revert to whatever the user actually picked once
  // zoom returns to 1x.
  const zoomQualityBoostRef = useRef(false);
  useEffect(() => {
    const zoomedIn = zoom.scale > 1.15;
    if (zoomedIn === zoomQualityBoostRef.current) return;
    zoomQualityBoostRef.current = zoomedIn;
    sessionRef.current?.sendSystemCommand({ kind: "quality-request", level: zoomedIn ? "high" : qualityLevel });
  }, [zoom.scale, qualityLevel]);
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startCenterX: number;
    startCenterY: number;
    startPanX: number;
    startPanY: number;
    // Undecided until either the finger spacing or the centroid has moved
    // enough to tell a pinch from a two-finger pan apart — deliberately a
    // separate "wait and see" state rather than defaulting to one of them,
    // which used to send real scroll-wheel input to the host during the
    // ambiguous first moments of almost every real pinch gesture (they're
    // rarely perfectly symmetric from the very first frame).
    gestureType: "undecided" | "zoom" | "pan";
  } | null>(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  // 3-finger drag = scroll the remote page/document (mouse wheel), separate
  // from the 2-finger pinch/pan-while-zoomed gesture above. Tracks the last
  // centroid so each move sends an incremental wheel delta, like a real
  // trackpad/wheel rather than one big jump.
  const threeFingerRef = useRef<{ lastY: number } | null>(null);

  function touchDistance(touches: { pageX: number; pageY: number }[]): number {
    return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  }
  function touchCentroid(touches: { pageX: number; pageY: number }[]): { x: number; y: number } {
    const x = touches.reduce((sum, t) => sum + t.pageX, 0) / touches.length;
    const y = touches.reduce((sum, t) => sum + t.pageY, 0) / touches.length;
    return { x, y };
  }
  // Where the video's actual pixels fall within videoLayoutRef under
  // objectFit="contain" — the rest is letterbox/pillarbox bars. Expressed in
  // the same (unscaled) container-local coordinate space the zoom math
  // below already works in; scale-invariant since RTCView's own box (zoomed
  // or not) always keeps the container's aspect ratio, only ever uniformly
  // bigger.
  function handleVideoDimensionsChange(e: { nativeEvent: { width: number; height: number } }): void {
    videoDimsRef.current = { width: e.nativeEvent.width, height: e.nativeEvent.height };
  }
  function getContentRect(): { x: number; y: number; width: number; height: number } {
    const { width: cw, height: ch } = videoLayoutRef.current;
    const { width: vw, height: vh } = videoDimsRef.current;
    if (!vw || !vh || !cw || !ch) return { x: 0, y: 0, width: cw, height: ch };
    if (vw / vh > cw / ch) {
      const height = cw / (vw / vh);
      return { x: 0, y: (ch - height) / 2, width: cw, height };
    }
    const width = ch * (vw / vh);
    return { x: (cw - width) / 2, y: 0, width, height: ch };
  }
  // Inverts the current zoom/pan transform: page-absolute touch point → the
  // underlying (unzoomed) content point, as a 0..1 fraction of the video.
  // RN's transform array `[translateX, translateY, scale]` applies translate
  // FIRST (in the view's own local space), then scale around its center — so
  // a content point p maps to screen position: center + S*((p - center) + pan).
  function pageToContentPct(pageX: number, pageY: number): { xPct: number; yPct: number } {
    const { x: originX, y: originY, width, height } = videoLayoutRef.current;
    const { scale, panX, panY } = zoomRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const lx = pageX - originX;
    const ly = pageY - originY;
    const contentX = cx + (lx - cx) / scale - panX;
    const contentY = cy + (ly - cy) / scale - panY;
    const rect = getContentRect();
    return {
      xPct: Math.min(1, Math.max(0, (contentX - rect.x) / rect.width)),
      yPct: Math.min(1, Math.max(0, (contentY - rect.y) / rect.height)),
    };
  }
  // Pan needed so that a given content point (0..1 fraction) stays under a
  // given page-absolute screen point at a given scale — used both to zoom in
  // centered on a double-tap, and to keep the pinch's start point anchored
  // under the fingers as the gesture continues.
  function panToKeepContentAt(contentXPct: number, contentYPct: number, pageX: number, pageY: number, scale: number): { panX: number; panY: number } {
    const { x: originX, y: originY, width, height } = videoLayoutRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const lx = pageX - originX;
    const ly = pageY - originY;
    const rect = getContentRect();
    const contentX = rect.x + contentXPct * rect.width;
    const contentY = rect.y + contentYPct * rect.height;
    const maxPanX = ((scale - 1) * width) / (2 * scale);
    const maxPanY = ((scale - 1) * height) / (2 * scale);
    const panX = Math.min(maxPanX, Math.max(-maxPanX, (lx - cx) / scale - (contentX - cx)));
    const panY = Math.min(maxPanY, Math.max(-maxPanY, (ly - cy) / scale - (contentY - cy)));
    return { panX, panY };
  }
  // Forward transform (content 0..1 fraction → local screen point, relative to
  // videoWrap) — the inverse of pageToContentPct's math — used to draw the
  // mouse-mode cursor overlay at the right spot, including while zoomed.
  function contentPctToLocal(xPct: number, yPct: number): { lx: number; ly: number } {
    const { width, height } = videoLayoutRef.current;
    const { scale, panX, panY } = zoomRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const rect = getContentRect();
    const contentX = rect.x + xPct * rect.width;
    const contentY = rect.y + yPct * rect.height;
    const lx = cx + scale * (contentX - cx + panX);
    const ly = cy + scale * (contentY - cy + panY);
    return { lx, ly };
  }
  // While zoomed in, keeps the virtual cursor from wandering out of the
  // visible (panned) viewport — nudges pan just enough to bring it back
  // within a margin, like most editors/canvases auto-scroll near an edge.
  // Only ever touches panX/panY (never scale), so this is always the cheap
  // reposition-only path regardless of zoomLive — no SurfaceView resize.
  function scrollToKeepCursorVisible(xPct: number, yPct: number): void {
    const { scale, panX, panY } = zoomRef.current;
    if (scale <= 1.01) return; // whole content already visible, nothing to scroll
    const { width, height } = videoLayoutRef.current;
    if (!width || !height) return;
    const margin = 32;
    const { lx, ly } = contentPctToLocal(xPct, yPct);
    const maxPanX = ((scale - 1) * width) / (2 * scale);
    const maxPanY = ((scale - 1) * height) / (2 * scale);
    let newPanX = panX;
    let newPanY = panY;
    if (lx < margin) newPanX += (margin - lx) / scale;
    else if (lx > width - margin) newPanX -= (lx - (width - margin)) / scale;
    if (ly < margin) newPanY += (margin - ly) / scale;
    else if (ly > height - margin) newPanY -= (ly - (height - margin)) / scale;
    newPanX = Math.min(maxPanX, Math.max(-maxPanX, newPanX));
    newPanY = Math.min(maxPanY, Math.max(-maxPanY, newPanY));
    if (newPanX !== panX || newPanY !== panY) setZoom({ scale, panX: newPanX, panY: newPanY });
  }

  // --- Mouse mode (trackpad-style relative control, vs. touch mode's
  // absolute tap-to-position) — matches TeamViewer's "Muis-modus". ---
  const [interactionMode, setInteractionModeState] = useState<"touch" | "mouse">("touch");
  const interactionModeRef = useRef(interactionMode);
  function setInteractionMode(mode: "touch" | "mouse"): void {
    interactionModeRef.current = mode;
    setInteractionModeState(mode);
  }
  const [virtualCursor, setVirtualCursorState] = useState({ xPct: 0.5, yPct: 0.5 });
  const virtualCursorRef = useRef(virtualCursor);
  function setVirtualCursor(next: { xPct: number; yPct: number }): void {
    virtualCursorRef.current = next;
    setVirtualCursorState(next);
  }
  // Mouse mode's click-drag ("selecteren") arms on the second tap of a
  // double-tap (matches TeamViewer's muis-modus exactly) rather than on a
  // held-still timer — a plain single-finger drag, however slowly it
  // proceeds, now never arms it, however long it takes.
  const mouseGestureRef = useRef({ downTime: 0, buttonDown: false, dragSelectArmed: false });
  const lastMouseTapRef = useRef({ time: 0, x: 0, y: 0 });
  // Touch mode's single-finger disambiguation (matches TeamViewer's
  // touch-modus exactly): "pending" until either enough drift or enough
  // hold-time decides it — moving early makes it "scrolling" (remote scroll,
  // never touches the cursor), staying still past the long-press window
  // first makes it "dragSelecting" (click-and-drag from the press point).
  const touchGestureRef = useRef<{ phase: "pending" | "scrolling" | "dragSelecting"; downTime: number; downX: number; downY: number }>({
    phase: "pending",
    downTime: 0,
    downX: 0,
    downY: 0,
  });

  function moveVirtualCursor(dxPx: number, dyPx: number): void {
    const { width, height } = videoLayoutRef.current;
    if (!width || !height) return;
    const sensitivity = 1.8; // trackpad-like acceleration, not 1:1 with finger movement
    const next = {
      xPct: Math.min(1, Math.max(0, virtualCursorRef.current.xPct + (dxPx / width) * sensitivity)),
      yPct: Math.min(1, Math.max(0, virtualCursorRef.current.yPct + (dyPx / height) * sensitivity)),
    };
    setVirtualCursor(next);
    scrollToKeepCursorVisible(next.xPct, next.yPct);
  }

  function sendCursorEvent(kind: "mousedown" | "mouseup" | "mousemove", button: "left" | "right" = "left"): void {
    const { xPct, yPct } = virtualCursorRef.current;
    if (kind === "mousemove") sessionRef.current?.sendInput({ kind, xPct, yPct });
    else sessionRef.current?.sendInput({ kind, xPct, yPct, button });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = randomDeviceId();
        await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      }
      if (cancelled) return;
      setMyId(id);

      const signaling = new Signaling(DEFAULT_SIGNALING_URL);
      signalingRef.current = signaling;
      // "hello" re-registers this device's ID with the server's registry —
      // must fire on every reconnect (Signaling now retries automatically
      // after a dropped connection), not just the first one, or this device
      // would be connected but unreachable by ID after any blip.
      signaling.onStatus((status) => {
        setServerStatus(status === "connected" ? "connected" : "disconnected");
        if (status === "connected") signaling.send({ type: "hello", id });
      });
      signaling.onMessage((msg) => handleServerMessage(msg));
      try {
        await signaling.connect();
      } catch {
        setServerStatus("disconnected");
      }

      // Push: register a token if Firebase is actually configured (no-ops
      // gracefully otherwise, see docs/MOBILE.md §5). Re-register on refresh
      // since FCM tokens can rotate at any time.
      await requestNotificationPermission();
      await ensureNotificationChannels();
      const token = await getPushToken();
      if (token) signaling.send({ type: "register-push-token", token });
    })();

    const unsubRefresh = onPushTokenRefresh((token) => {
      signalingRef.current?.send({ type: "register-push-token", token });
    });
    // Foreground: shown directly as the in-app confirm modal, no system
    // notification needed since the app is already right there.
    const unsubForeground = onForegroundPush((fromId, notification) => addNotification({ ...notification, replyTo: fromId }));
    // Background/killed: these fire for notifications *we* displayed via
    // notifee (see index.js's background handler + src/notifications.ts),
    // not Firebase's own auto-display — replaces onPushOpenedApp/
    // getInitialPush, which only ever fired for Firebase-displayed ones.
    const unsubOpened = onNotificationPress((fromId, notification) => addNotification({ ...notification, replyTo: fromId }));
    getInitialNotificationPress().then((initial) => {
      if (initial) addNotification({ ...initial.notification, replyTo: initial.fromId });
    });

    return () => {
      cancelled = true;
      signalingRef.current?.close();
      sessionRef.current?.close();
      unsubRefresh();
      unsubForeground();
      unsubOpened();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    isAccessibilityServiceEnabled().then(setAccessibilityEnabled);
    // The only way this actually changes is the user visiting Settings and
    // back (Android has no event for it) — re-check whenever the app returns
    // to the foreground, which covers exactly that path.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") isAccessibilityServiceEnabled().then(setAccessibilityEnabled);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    getSavedDevices().then((devices) => setSavedDevicesState(sortSavedDevices(devices)));
  }, []);

  useEffect(() => {
    getOpenAiApiKey().then((key) => setOpenaiKeyConfigured(!!key));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === "dark" || v === "light") setThemeState(v);
    });
    AsyncStorage.getItem(QUALITY_LEVEL_KEY).then((v) => {
      if (v === "auto" || v === "high" || v === "low") setQualityLevelState(v);
    });
    AsyncStorage.getItem(SHOW_CURSOR_KEY).then((v) => {
      if (v !== null) setShowRemoteCursorState(v === "1");
    });
  }, []);

  async function handleServerMessage(msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case "welcome":
        setMyId(msg.id);
        break;
      case "connect-response":
        if (msg.accept) {
          const pending = pendingConnectRef.current;
          if (pending?.remember) {
            saveDevice({ id: pending.targetId, label: pending.label, passwordHash: pending.passwordHash, viewOnly: false }).then((devices) => {
              setSavedDevicesState(sortSavedDevices(devices));
              showToast(`"${pending.label}" opgeslagen.`);
            });
          }
          pendingConnectRef.current = null;
          startViewerSession(msg.fromId);
        } else {
          pendingConnectRef.current = null;
          if (msg.reason === "totp-required" || msg.reason === "bad-totp") {
            setConnectStatus("");
            setTotpCode("");
            setTotpRequired(msg.reason);
            break;
          }
          const reasons: Record<string, string> = {
            offline: "Dat apparaat is niet online.",
            "bad-password": "Onjuist wachtwoord.",
            declined: "De partner heeft de aanvraag geweigerd.",
            busy: "De partner heeft al een actieve sessie.",
          };
          setConnectStatus(reasons[msg.reason ?? ""] ?? "Verbinding geweigerd.");
        }
        break;
      case "peer-disconnected":
        endSession();
        break;
      case "incoming-request": {
        const expectedHash = await sha256Hex(hostSessionPassword);
        if (msg.passwordHash !== expectedHash) {
          signalingRef.current?.send({ type: "connect-response", targetId: msg.fromId, accept: false, reason: "bad-password" });
          break;
        }
        if (roleRef.current) {
          signalingRef.current?.send({ type: "connect-response", targetId: msg.fromId, accept: false, reason: "busy" });
          break;
        }
        setPendingIncoming({ fromId: msg.fromId });
        break;
      }
      case "signal": {
        const p = msg.payload as { sdp?: { type: string }; candidate?: any };
        if (p.sdp?.type === "answer") sessionRef.current?.applyAnswer(p.sdp);
        else if (p.sdp?.type === "offer" && roleRef.current === "host") captureAndAnswer(p.sdp);
        else if (p.candidate) sessionRef.current?.addRemoteCandidate(p.candidate);
        break;
      }
      case "notify":
        addNotification({ ...msg.notification, replyTo: msg.fromId });
        break;
      case "notify-response":
        updateNotificationStatus(msg.notificationId, msg.decision);
        if (activeConfirmMatches(msg.notificationId)) showNextConfirm();
        break;
    }
  }

  function addNotification(entry: NotifyEntry): void {
    // The same notification can arrive twice — once over the WebSocket (if
    // still connected) and once via push (server sends both, see
    // server/src/index.ts) — so de-dupe by the bridge's own notification id.
    if (seenNotificationIdsRef.current.has(entry.id)) return;
    seenNotificationIdsRef.current.add(entry.id);
    setNotifications((prev) => [entry, ...prev].slice(0, 20));
    if (entry.kind === "confirm") {
      confirmQueueRef.current.push(entry);
      if (!activeConfirm) showNextConfirm();
    }
  }

  function updateNotificationStatus(id: string, status: "allow" | "deny"): void {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, status } : n)));
  }

  function activeConfirmMatches(id: string): boolean {
    return activeConfirm?.id === id;
  }

  function showNextConfirm(): void {
    const next = confirmQueueRef.current.shift() ?? null;
    setActiveConfirm(next);
  }

  function answerConfirm(decision: "allow" | "deny"): void {
    if (!activeConfirm) return;
    updateNotificationStatus(activeConfirm.id, decision);
    if (activeConfirm.replyTo) {
      signalingRef.current?.send({
        type: "notify-response",
        targetId: activeConfirm.replyTo,
        notificationId: activeConfirm.id,
        decision,
      });
    }
    showNextConfirm();
  }

  function connectTo(id: string, passwordHash: string, remember: boolean, label: string, totpCodeValue?: string): void {
    console.log("[connectTo] called, id=", id);
    console.trace("[connectTo] call stack");
    pendingConnectRef.current = { targetId: id, passwordHash, remember, label };
    lastConnectRef.current = { targetId: id, passwordHash };
    setConnectStatus("Verbinding maken…");
    signalingRef.current?.send({ type: "connect-request", targetId: id, fromId: myId, passwordHash, totpCode: totpCodeValue });
  }

  function submitTotpCode(): void {
    if (!lastConnectRef.current) return;
    const { targetId: retryId, passwordHash } = lastConnectRef.current;
    const code = totpCode.trim();
    setTotpRequired(null);
    connectTo(retryId, passwordHash, false, formatId(retryId), code);
  }

  async function onConnectPress(): Promise<void> {
    const cleanTarget = targetId.replace(/\s+/g, "");
    if (!/^\d{9}$/.test(cleanTarget)) {
      setConnectStatus("Vul een geldig 9-cijferig BromeoRemote-ID in.");
      return;
    }
    const passwordHash = await sha256Hex(targetPassword);
    connectTo(cleanTarget, passwordHash, rememberDevice, rememberLabel.trim() || formatId(cleanTarget));
  }

  // One-tap reconnect: the stored passwordHash is resent as-is — the wire
  // protocol only ever carries the hash, never the plaintext, so there's
  // nothing to re-derive here.
  function connectToSaved(device: SavedDevice): void {
    connectTo(device.id, device.passwordHash, false, device.label);
  }

  // Mirrors the desktop client's scheduleAutoReconnect: same 15s interval,
  // same ~5 minute cap, same "stop as soon as a session exists again" check.
  function scheduleAutoReconnect(reconnectId: string, passwordHash: string): void {
    const intervalMs = 15_000;
    const maxAttempts = 20;
    let attempt = 0;
    showToast(`Verbinding verbroken. Opnieuw verbinden met ${formatId(reconnectId)}…`);
    const tryOnce = () => {
      attempt++;
      if (sessionRef.current || attempt > maxAttempts) return;
      connectTo(reconnectId, passwordHash, false, formatId(reconnectId));
      setTimeout(tryOnce, intervalMs);
    };
    setTimeout(tryOnce, intervalMs);
  }

  function handleToggleFavorite(id: string): void {
    toggleFavorite(id).then((devices) => setSavedDevicesState(sortSavedDevices(devices)));
  }

  function handleRemoveSaved(id: string, label: string): void {
    Alert.alert(`"${label}" verwijderen?`, "Dit verwijdert het opgeslagen apparaat uit je adresboek.", [
      { text: "Annuleren", style: "cancel" },
      {
        text: "Verwijderen",
        style: "destructive",
        onPress: () =>
          removeSavedDevice(id).then((devices) => {
            setSavedDevicesState(sortSavedDevices(devices));
            showToast("Apparaat verwijderd.");
          }),
      },
    ]);
  }

  function startViewerSession(peerId: string): void {
    const signaling = signalingRef.current;
    if (!signaling) return;
    setCurrentRole("viewer");
    setInteractionMode("touch");
    setVirtualCursor({ xPct: 0.5, yPct: 0.5 });
    sessionStartedAtRef.current = Date.now();
    filesTransferredCountRef.current = 0;
    sessionReachedConnectedOnceRef.current = false;
    const session = new MobileSession(DEFAULT_ICE_SERVERS, signaling, peerId, {
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setSessionPeer(peerId);
        setInSession(true);
      },
      onConnectionState: (state) => {
        if (state === "connected") sessionReachedConnectedOnceRef.current = true;
        if (["disconnected", "failed", "closed"].includes(state)) {
          console.log("[viewer] connection ended, state=", state, "restartRequestedFor=", restartRequestedForRef.current, "peerId=", peerId);
          // sessionStartedAtRef is already null by the time a *deliberate*
          // hangup (disconnect button, peer-initiated bye, ...) reaches
          // here, since endSession() clears it before session.close() —
          // so surpriseDrop only true for a genuine unexpected drop of a
          // session that actually connected (e.g. the NAT-timeout-driven
          // drop a direct P2P path can hit — see
          // docs/WEBRTC-TURN-DEBUGGING.md).
          const surpriseDrop = sessionStartedAtRef.current != null && sessionReachedConnectedOnceRef.current;
          const reconnect =
            restartRequestedForRef.current === peerId
              ? lastConnectRef.current
              : surpriseDrop && lastConnectRef.current?.targetId === peerId
                ? lastConnectRef.current
                : null;
          restartRequestedForRef.current = null;
          endSession();
          if (reconnect) {
            console.log("[viewer] scheduling auto-reconnect");
            scheduleAutoReconnect(reconnect.targetId, reconnect.passwordHash);
          }
        }
      },
      onStats: (stats) => {
        const parts: string[] = [];
        if (stats.width != null && stats.height != null) parts.push(`${stats.width}×${stats.height}`);
        if (stats.fps != null) parts.push(`${stats.fps} fps`);
        if (stats.bitrateKbps != null) parts.push(`${stats.bitrateKbps} kbps`);
        if (stats.rttMs != null) parts.push(`${stats.rttMs} ms`);
        setStatsText(parts.join(" · "));
      },
      onChatMessage: receiveChatMessage,
      onFileOffer: handleFileOffer,
      onFileProgress: handleFileProgress,
      onFileComplete: handleFileComplete,
      onSystemCommand: (cmd) => {
        // `enabled` is the host's actual resulting state (not an echo of
        // what we requested) — always safe to trust directly, `ok` just
        // decides whether we also surface a failure warning.
        if (cmd.kind === "block-input-status") {
          setInputBlocked(cmd.enabled);
          if (cmd.ok) showToast(cmd.enabled ? "Externe invoer geblokkeerd." : "Externe invoer niet meer geblokkeerd.");
          else Alert.alert("Mislukt", "Blokkeren van externe invoer op de host is mislukt.");
        } else if (cmd.kind === "hide-wallpaper-status") {
          setWallpaperHidden(cmd.enabled);
          if (!cmd.ok) Alert.alert("Mislukt", "Achtergrond verbergen op de host is mislukt (alleen op Windows).");
        } else if (cmd.kind === "ctrl-alt-del-status") {
          if (cmd.ok) showToast("Ctrl+Alt+Del verzonden.");
          else Alert.alert("Mislukt", cmd.installed ? "Versturen van Ctrl+Alt+Del is mislukt." : "De host heeft Ctrl+Alt+Del op afstand niet ingeschakeld.");
        } else if (cmd.kind === "monitor-list") {
          setMonitors(cmd.monitors);
        } else if (cmd.kind === "window-list") {
          setWindowList(cmd.windows);
        }
      },
    });
    sessionRef.current = session;
    session.startAsViewer();
    // Apply the persisted quality preference to this session too — mirrors
    // the desktop viewer applying its own saved setting right after connecting.
    session.sendSystemCommand({ kind: "quality-request", level: qualityLevel });
    setConnectStatus("Verbonden.");
  }

  function respondToIncoming(accept: boolean): void {
    if (!pendingIncoming) return;
    const fromId = pendingIncoming.fromId;
    setPendingIncoming(null);
    if (accept) {
      signalingRef.current?.send({ type: "connect-response", targetId: fromId, accept: true });
      startHostSession(fromId);
    } else {
      signalingRef.current?.send({ type: "connect-response", targetId: fromId, accept: false, reason: "declined" });
    }
  }

  // Just creates the session and waits — the offer itself arrives moments
  // later via a separate "signal" message once the viewer sees our accept.
  function startHostSession(peerId: string): void {
    const signaling = signalingRef.current;
    if (!signaling) return;
    setCurrentRole("host");
    const translator = new RemoteInputTranslator();
    const session = new MobileSession(DEFAULT_ICE_SERVERS, signaling, peerId, {
      onConnectionState: (state) => {
        if (["disconnected", "failed", "closed"].includes(state)) endSession();
      },
      onInputEvent: (event) => translator.handle(event),
    });
    sessionRef.current = session;
    setSessionPeer(peerId);
    setInSession(true);
  }

  // Triggers Android's own screen-recording confirmation dialog (MediaProjection
  // isn't grantable silently, by design — the phone's own user must confirm it
  // even though they already accepted the BromeoRemote request a moment ago).
  async function captureAndAnswer(offer: any): Promise<void> {
    try {
      const captureStream = await mediaDevices.getDisplayMedia();
      await sessionRef.current?.acceptAsHost(offer, captureStream);
    } catch {
      endSession();
    }
  }

  function endSession(): void {
    // Mirrors client/src/renderer/app.ts's showSessionSummary() (same
    // wording), just as a toast rather than a saved history entry — mobile
    // doesn't have desktop's session-history log.
    if (sessionStartedAtRef.current != null) {
      const durationSec = Math.round((Date.now() - sessionStartedAtRef.current) / 1000);
      const filesText = filesTransferredCountRef.current === 0 ? "geen bestanden overgezet" : `${filesTransferredCountRef.current} bestand(en) overgezet`;
      showToast(`Sessie beëindigd — duurde ${formatDuration(durationSec)}, ${filesText}.`);
      sessionStartedAtRef.current = null;
      filesTransferredCountRef.current = 0;
    }
    sessionRef.current?.close();
    sessionRef.current = null;
    setCurrentRole(null);
    setInSession(false);
    setRemoteStream(null);
    setStatsText("");
    setConnectStatus("");
    setZoom({ scale: 1, panX: 0, panY: 0 });
    // The host has its own safety net that releases this on disconnect
    // regardless of what we do here — this just keeps this UI's toggle from
    // showing a stale "blocked" state at the start of the next session.
    setInputBlocked(false);
    setWallpaperHidden(false);
    setChatMessages([]);
    setHasUnreadChat(false);
    setFileTransfers([]);
    setMonitors([]);
    setActiveMonitorId(null);
    setWindowList([]);
    setActiveAppWindow(null);
    setAiBuddyLog([]);
    setAiBuddyScreenshot(null);
    setAiBuddySending(false);
  }

  function disconnectSession(): void {
    if (sessionRef.current && sessionPeer) {
      signalingRef.current?.send({ type: "bye", targetId: sessionPeer });
    }
    endSession();
  }

  // --- Touch → mouse mapping (+ pinch-to-zoom) ---
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 3) {
          threeFingerRef.current = { lastY: touchCentroid(touches).y };
          return;
        }
        if (touches.length >= 2) {
          const c = touchCentroid(touches);
          pinchRef.current = {
            startDistance: touchDistance(touches),
            startScale: zoomRef.current.scale,
            startCenterX: c.x,
            startCenterY: c.y,
            startPanX: zoomRef.current.panX,
            startPanY: zoomRef.current.panY,
            gestureType: "undecided",
          };
          setZoomLive(true);
          return;
        }
        const { pageX, pageY } = evt.nativeEvent;
        const now = Date.now();

        if (interactionModeRef.current === "mouse") {
          const lastTap = lastMouseTapRef.current;
          // Same double-tap window/proximity check touch-mode's zoom uses —
          // judged by raw finger position, since that's what a real
          // double-tap is, regardless of where the virtual cursor is.
          const isSecondTapOfDoubleTap = now - lastTap.time < 300 && Math.hypot(pageX - lastTap.x, pageY - lastTap.y) < 40;
          lastMouseTapRef.current = { time: now, x: pageX, y: pageY };
          lastTouchRef.current = { x: pageX, y: pageY, time: now, moved: false };
          mouseGestureRef.current = { downTime: now, buttonDown: false, dragSelectArmed: isSecondTapOfDoubleTap };
          return;
        }

        const last = lastTapRef.current;
        const isDoubleTap = now - last.time < 300 && Math.hypot(pageX - last.x, pageY - last.y) < 40;
        lastTapRef.current = { time: now, x: pageX, y: pageY };
        if (isDoubleTap) {
          lastTapRef.current = { time: 0, x: 0, y: 0 }; // consume, avoid a triple-tap re-triggering
          if (zoomRef.current.scale > 1.05) {
            setZoom({ scale: 1, panX: 0, panY: 0 });
          } else {
            const { xPct, yPct } = pageToContentPct(pageX, pageY);
            setZoom({ scale: 2.5, ...panToKeepContentAt(xPct, yPct, pageX, pageY, 2.5) });
          }
          return;
        }
        // Nothing sent yet — touch-modus's single finger is three-way
        // ambiguous at this point (tap-click / scroll-drag / long-press then
        // drag-select) and onPanResponderMove/Release resolve it below,
        // matching TeamViewer's touch-modus exactly.
        lastTouchRef.current = { x: pageX, y: pageY, time: now, moved: false };
        touchGestureRef.current = { phase: "pending", downTime: now, downX: pageX, downY: pageY };
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 3) {
          const y = touchCentroid(touches).y;
          if (!threeFingerRef.current) threeFingerRef.current = { lastY: y };
          const deltaY = y - threeFingerRef.current.lastY;
          threeFingerRef.current.lastY = y;
          if (deltaY !== 0) sessionRef.current?.sendInput({ kind: "wheel", deltaX: 0, deltaY: -deltaY / 4 });
          return;
        }
        if (touches.length >= 2) {
          if (!pinchRef.current) {
            // The common case: fingers almost never touch down in the exact
            // same frame, so onPanResponderGrant usually only sees one touch
            // and this is where the second finger actually shows up. Start
            // tracking the pinch here instead of silently doing nothing.
            const c = touchCentroid(touches);
            pinchRef.current = {
              startDistance: touchDistance(touches),
              startScale: zoomRef.current.scale,
              startCenterX: c.x,
              startCenterY: c.y,
              startPanX: zoomRef.current.panX,
              startPanY: zoomRef.current.panY,
              gestureType: "undecided",
            };
            setZoomLive(true);
            // Cancel whatever single-finger action was already in flight
            // from the first finger (a tap/click-drag it can no longer be).
            if (interactionModeRef.current === "mouse") {
              if (mouseGestureRef.current.buttonDown) sendCursorEvent("mouseup");
              mouseGestureRef.current = { downTime: 0, buttonDown: false, dragSelectArmed: false };
            } else if (touchGestureRef.current.phase === "dragSelecting") {
              sendMouseAt("mouseup", lastTouchRef.current.x, lastTouchRef.current.y);
            }
            touchGestureRef.current = { phase: "pending", downTime: 0, downX: 0, downY: 0 };
            return; // next move computes a real ratio/drift against this baseline
          }
          const pinch = pinchRef.current;
          const distance = touchDistance(touches);
          const ratio = distance / pinch.startDistance;
          const centroid = touchCentroid(touches);

          if (pinch.gestureType === "undecided") {
            const scaleDeviation = Math.abs(ratio - 1);
            const drift = Math.hypot(centroid.x - pinch.startCenterX, centroid.y - pinch.startCenterY);
            // Real pinches are rarely perfectly symmetric from frame one, so
            // this waits for a clear signal instead of defaulting to "pan" —
            // that used to send real scroll-wheel input to the host for
            // every ambiguous early frame of almost any pinch, which looked
            // like (and was) the remote screen shifting on its own while the
            // user was just trying to zoom.
            if (scaleDeviation < 0.06 && drift < 14) return;
            pinch.gestureType = scaleDeviation >= 0.06 ? "zoom" : "pan";
          }

          if (pinch.gestureType === "pan") {
            // "Twee vingers om te schuiven" — pans the local zoomed
            // viewport only, never touches the remote session. A no-op at
            // scale 1: maxPanX/Y is 0 there, so there's nothing to pan into.
            const scale = zoomRef.current.scale;
            const { width, height } = videoLayoutRef.current;
            const maxPanX = ((scale - 1) * width) / (2 * scale);
            const maxPanY = ((scale - 1) * height) / (2 * scale);
            const panX = Math.min(maxPanX, Math.max(-maxPanX, pinch.startPanX + (centroid.x - pinch.startCenterX) / scale));
            const panY = Math.min(maxPanY, Math.max(-maxPanY, pinch.startPanY + (centroid.y - pinch.startCenterY) / scale));
            setZoom({ scale, panX, panY });
            return;
          }

          // Anchored to the pinch's fixed starting point, not the live
          // (drifting) centroid — real pinches rarely stay perfectly
          // centered, and re-anchoring to the moving centroid made the image
          // visibly scroll/drift during an ordinary pinch. No upper bound:
          // maxPanX/Y (derived from scale) already keeps panning in bounds
          // at any zoom level, so there's no reason to cap scale itself.
          const newScale = Math.max(1, pinch.startScale * ratio);
          const { xPct, yPct } = pageToContentPct(pinch.startCenterX, pinch.startCenterY);
          setZoom({ scale: newScale, ...panToKeepContentAt(xPct, yPct, pinch.startCenterX, pinch.startCenterY, newScale) });
          return;
        }

        if (interactionModeRef.current === "mouse") {
          const { pageX, pageY } = evt.nativeEvent;
          const last = lastTouchRef.current;
          moveVirtualCursor(pageX - last.x, pageY - last.y);
          lastTouchRef.current = { x: pageX, y: pageY, time: last.time, moved: true };
          const gesture = mouseGestureRef.current;
          if (!gesture.buttonDown && gesture.dragSelectArmed) {
            // Dragging on the second tap of a double-tap — matches
            // TeamViewer muis-modus's "Dubbele-tik en slepen om te
            // selecteren" exactly. A plain single-finger drag (not preceded
            // by a same-spot tap moments earlier) never arms this, however
            // long or slow it is.
            sendCursorEvent("mousedown");
            gesture.buttonDown = true;
          }
          sendCursorEvent("mousemove");
          return;
        }

        // touch-modus: three-way disambiguation matching TeamViewer exactly
        // — "Eén vinger om te scrollen" vs "Lang drukken en slepen om te
        // selecteren" vs the tap-to-click handled entirely on release below.
        const { pageX, pageY } = evt.nativeEvent;
        lastTouchRef.current.moved = true;
        const g = touchGestureRef.current;
        if (g.phase === "pending") {
          const drift = Math.hypot(pageX - g.downX, pageY - g.downY);
          if (drift < 8) return; // still just jitter — keep waiting, don't decide yet
          if (Date.now() - g.downTime < 500) {
            g.phase = "scrolling"; // moved before the long-press window elapsed
          } else {
            g.phase = "dragSelecting"; // held still past the window, *then* moved
            sendMouseAt("mousedown", g.downX, g.downY);
          }
        }
        if (g.phase === "scrolling") {
          sessionRef.current?.sendInput({ kind: "wheel", deltaX: 0, deltaY: -gestureState.dy / 4 });
          return;
        }
        sendMouseAt("mousemove", pageX, pageY);
      },
      onPanResponderRelease: (evt) => {
        pinchRef.current = null;
        threeFingerRef.current = null;
        setZoomLive(false);
        if (evt.nativeEvent.touches.length >= 1) return; // another finger still down (was a 2-finger gesture)

        if (interactionModeRef.current === "mouse") {
          const gesture = mouseGestureRef.current;
          if (gesture.buttonDown) {
            sendCursorEvent("mouseup");
          } else if (!lastTouchRef.current.moved) {
            if (Date.now() - gesture.downTime > 500) {
              sendCursorEvent("mousedown", "right");
              sendCursorEvent("mouseup", "right");
            } else {
              sendCursorEvent("mousedown");
              sendCursorEvent("mouseup");
            }
          }
          mouseGestureRef.current = { downTime: 0, buttonDown: false, dragSelectArmed: false };
          return;
        }

        const g = touchGestureRef.current;
        if (g.phase === "dragSelecting") {
          sendMouseAt("mouseup", lastTouchRef.current.x, lastTouchRef.current.y);
        } else if (g.phase === "pending") {
          // Never moved: either a quick tap, or a long-press released
          // without ever dragging — "Lange tik voor rechtsklikken".
          const { x, y } = lastTouchRef.current;
          if (Date.now() - g.downTime > 500) {
            sendMouseAt("mousedown", x, y, "right");
            sendMouseAt("mouseup", x, y, "right");
          } else {
            sendMouseAt("mousedown", x, y);
            sendMouseAt("mouseup", x, y);
          }
        }
        // "scrolling" phase needs nothing on release — it never touched the cursor.
        touchGestureRef.current = { phase: "pending", downTime: 0, downX: 0, downY: 0 };
      },
    })
  ).current;

  function sendMouseAt(kind: "mousedown" | "mouseup" | "mousemove", pageX: number, pageY: number, button: "left" | "right" = "left"): void {
    const { width, height } = videoLayoutRef.current;
    if (!width || !height) return;
    const { xPct, yPct } = pageToContentPct(pageX, pageY);
    if (kind === "mousemove") sessionRef.current?.sendInput({ kind, xPct, yPct });
    else sessionRef.current?.sendInput({ kind, xPct, yPct, button });
  }

  // --- On-screen keyboard bridge ---
  function onKeyboardChangeText(text: string): void {
    if (text.length > 0) sessionRef.current?.sendInput({ kind: "text", value: text });
    setKeyboardDraft("");
  }
  function onKeyboardKeyPress(key: string): void {
    if (key === "Backspace") {
      sessionRef.current?.sendInput({ kind: "keydown", key: "Backspace", code: "Backspace" });
      sessionRef.current?.sendInput({ kind: "keyup", key: "Backspace", code: "Backspace" });
    } else if (key === "Enter") {
      sessionRef.current?.sendInput({ kind: "keydown", key: "Enter", code: "Enter" });
      sessionRef.current?.sendInput({ kind: "keyup", key: "Enter", code: "Enter" });
    }
  }

  // --- Shortcuts bar (TeamViewer-style: Kopiëren/Plakken/PrtScn/Alt-Tab/Opslaan) ---
  // Presses each code in order (so modifiers are already held down when the
  // main key goes down), then releases in reverse order — same as a person
  // holding Ctrl and tapping C, not releasing Ctrl until after.
  function sendShortcut(codes: string[]): void {
    for (const code of codes) sessionRef.current?.sendInput({ kind: "keydown", key: code, code });
    for (const code of [...codes].reverse()) sessionRef.current?.sendInput({ kind: "keyup", key: code, code });
  }

  // --- Quick actions (TeamViewer-style: Ctrl+Alt+Del / vergrendelen / herstarten) ---
  function lockRemote(): void {
    sessionRef.current?.sendSystemCommand({ kind: "lock-request" });
    setActivePanel(null);
    showToast("Vergrendelen aangevraagd.");
  }
  // Only works if the host has explicitly enabled it (Sessie-instellingen op
  // de desktop-app) — the host reports back via ctrl-alt-del-status if not.
  function sendCtrlAltDel(): void {
    sessionRef.current?.sendSystemCommand({ kind: "ctrl-alt-del-request" });
    setActivePanel(null);
  }
  // Whatever zoom/pan was dialed in applied to the *previous* video content
  // — switching source (desktop ↔ a specific window, or between windows)
  // swaps in content with a completely different resolution/aspect ratio,
  // but contentPctToLocal doesn't clamp its output to the visible container.
  // Carrying over a stale scale/pan onto new content could place the mouse-
  // mode cursor dot genuinely outside the visible video area. Resetting on
  // every source switch, and recentering the virtual cursor since its old
  // position was relative to content that no longer exists.
  function resetZoomAndCursorForNewSource(): void {
    setZoom({ scale: 1, panX: 0, panY: 0 });
    setVirtualCursor({ xPct: 0.5, yPct: 0.5 });
  }
  function switchMonitor(monitorId: string): void {
    setActiveMonitorId(monitorId);
    sessionRef.current?.sendSystemCommand({ kind: "switch-monitor", monitorId });
    resetZoomAndCursorForNewSource();
  }
  function currentPhoneAspect(): number {
    const { width, height } = Dimensions.get("window");
    return width / height;
  }
  // Window lists change far more often than monitor lists (programs
  // open/close constantly), so unlike monitors this is fetched fresh
  // on-demand rather than pushed once at session start.
  function openProgramsPanel(): void {
    sessionRef.current?.sendSystemCommand({ kind: "window-list-request" });
    setActivePanel("programs");
  }
  function selectProgram(win: WindowInfo): void {
    sessionRef.current?.sendSystemCommand({ kind: "switch-window", windowId: win.id, aspect: currentPhoneAspect() });
    setActiveAppWindow({ id: win.id, name: win.name });
    setActivePanel(null);
    resetZoomAndCursorForNewSource();
  }
  function closeProgramMode(): void {
    sessionRef.current?.sendSystemCommand({ kind: "switch-to-desktop" });
    setActiveAppWindow(null);
    resetZoomAndCursorForNewSource();
  }
  // While controlling a specific program, keep asking the host to resize
  // that window to match the phone's current aspect ratio as it's rotated —
  // "portrait houd = portrait venster, opzij houd = landscape venster".
  useEffect(() => {
    if (!activeAppWindow) return;
    const sub = Dimensions.addEventListener("change", () => {
      sessionRef.current?.sendSystemCommand({ kind: "resize-active-window", aspect: currentPhoneAspect() });
    });
    return () => sub.remove();
  }, [activeAppWindow]);
  function toggleBlockInput(): void {
    const enabling = !inputBlocked;
    sessionRef.current?.sendSystemCommand({ kind: "block-input", enabled: enabling });
    setInputBlocked(enabling);
  }
  function toggleHideWallpaper(): void {
    const enabling = !wallpaperHidden;
    sessionRef.current?.sendSystemCommand({ kind: "hide-wallpaper", enabled: enabling });
    setWallpaperHidden(enabling);
  }
  function restartRemote(): void {
    Alert.alert(
      "Computer herstarten?",
      `${formatId(sessionPeer)} wordt opnieuw opgestart. Niet-opgeslagen werk op dat apparaat kan verloren gaan.`,
      [
        { text: "Annuleren", style: "cancel" },
        {
          text: "Herstarten",
          style: "destructive",
          onPress: () => {
            sessionRef.current?.sendSystemCommand({ kind: "restart-request" });
            restartRequestedForRef.current = sessionPeer;
            setActivePanel(null);
            showToast("Herstart aangevraagd.");
          },
        },
      ]
    );
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.bootRoot}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.bg} />
        <Image source={logo2} style={styles.bootLogo} resizeMode="contain" />
        <ActivityIndicator size="small" color={colors.primary} style={styles.bootSpinner} />
        <Text style={styles.bootText}>Verbinden…</Text>
      </SafeAreaView>
    );
  }

  if (inSession && currentRole === "host") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} />
        <View style={styles.hostBanner}>
          <Text style={styles.hostBannerText}>{formatId(sessionPeer)} bekijkt en bedient deze telefoon</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.dangerBtn]} onPress={disconnectSession}>
            <Text style={styles.primaryBtnText}>Sessie beëindigen</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (inSession) {
    return (
      // Only the top edge — the video is deliberately full-bleed on the
      // other three (see videoWrap/floatingToolbarWrap below), so letting
      // SafeAreaView pad bottom/left/right here too would double up with
      // the insets applied directly to the toolbar and push it too far in.
      <SafeAreaView style={[styles.sessionRoot, { marginBottom: keyboardHeight }]} edges={["top"]}>
        <StatusBar barStyle="light-content" />
        <View
          ref={videoWrapRef}
          style={styles.videoWrap}
          onLayout={() => {
            // layout.x/y are parent-relative, not comparable to touch events'
            // page-absolute pageX/pageY — measureInWindow gives true screen coords.
            videoWrapRef.current?.measureInWindow((x, y, width, height) => {
              videoLayoutRef.current = { x, y, width, height };
            });
          }}
        >
          {/* panHandlers live on this inner layer (not videoWrap itself) so
              that expandBtn below — a real sibling, not a descendant of the
              gesture-capturing view — can actually receive its own taps.
              With panHandlers on the outer view, onStartShouldSetPanResponder
              returning true claims every touch inside videoWrap, including
              ones landing on expandBtn, before its onPress ever fires —
              exactly why "uitklappen" stopped working after being collapsed. */}
          <View style={styles.videoGestureLayer} {...panResponder.panHandlers}>
            {remoteStream &&
              (() => {
                // A CSS-style `transform: scale()` only stretches whatever
                // react-native-webrtc's native SurfaceViewRenderer already
                // rendered at this view's *laid-out* (unzoomed) pixel size —
                // that sizing happens in onLayout, before RN's transform is
                // ever applied, so no amount of upstream bitrate/resolution
                // improvement was ever reaching the screen while zoomed.
                // Growing the view's actual width/height instead makes the
                // native renderer redraw from the real decoded frame at the
                // bigger size — but that's a real SurfaceView buffer
                // reallocation, too heavy to do on every pinch-move touch
                // event (that's what caused the lag/overshoot/disappearing).
                // So: cheap transform-scale while zoomLive (finger still
                // moving), real resize once it settles. Positions/sizes
                // below reproduce the exact same on-screen result either
                // way (translate then scale-around-center, per
                // panToKeepContentAt/contentPctToLocal above) so none of the
                // gesture/coordinate logic elsewhere needs to change.
                const { width, height } = videoLayoutRef.current;
                if (!width || !height) {
                  return (
                    <RTCView
                      ref={rtcViewRef}
                      streamURL={remoteStream.toURL()}
                      style={styles.video}
                      objectFit="contain"
                      onDimensionsChange={handleVideoDimensionsChange}
                    />
                  );
                }
                const { scale, panX, panY } = zoom;
                if (zoomLive) {
                  return (
                    <RTCView
                      ref={rtcViewRef}
                      streamURL={remoteStream.toURL()}
                      style={[styles.video, { transform: [{ translateX: panX }, { translateY: panY }, { scale }] }]}
                      objectFit="contain"
                      onDimensionsChange={handleVideoDimensionsChange}
                    />
                  );
                }
                return (
                  <RTCView
                    ref={rtcViewRef}
                    streamURL={remoteStream.toURL()}
                    style={[
                      styles.videoZoomed,
                      {
                        left: (width / 2) * (1 - scale) + scale * panX,
                        top: (height / 2) * (1 - scale) + scale * panY,
                        width: width * scale,
                        height: height * scale,
                      },
                    ]}
                    objectFit="contain"
                    onDimensionsChange={handleVideoDimensionsChange}
                  />
                );
              })()}
            {interactionMode === "mouse" &&
              showRemoteCursor &&
              (() => {
                const { lx, ly } = contentPctToLocal(virtualCursor.xPct, virtualCursor.yPct);
                // Belt-and-braces: contentPctToLocal projects through the
                // current zoom/pan, which (briefly, e.g. mid content-source
                // switch) can point outside the visible container — clamp
                // the rendered dot itself so it can never appear off-screen,
                // independent of whatever reset the source-switch handlers
                // already do.
                const { width, height } = videoLayoutRef.current;
                const clampedLx = width ? Math.min(width, Math.max(0, lx)) : lx;
                const clampedLy = height ? Math.min(height, Math.max(0, ly)) : ly;
                return <View pointerEvents="none" style={[styles.cursorDot, { left: clampedLx - 10, top: clampedLy - 10 }]} />;
              })()}
          </View>
          {toastMessage && (
            // Nudged down when the program-mode bar is showing — both
            // anchor to top:16 by default and would otherwise overlap.
            <View pointerEvents="none" style={[styles.toast, activeAppWindow && styles.toastBelowAppModeBar]}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          )}
          {activeAppWindow && (
            <View style={styles.appModeBar} pointerEvents="box-none">
              <Text style={styles.appModeBarText} numberOfLines={1}>
                {activeAppWindow.name}
              </Text>
              <TouchableOpacity style={styles.appModeCloseBtn} onPress={closeProgramMode} accessibilityRole="button" accessibilityLabel="Programma sluiten, terug naar bureaublad">
                <X size={16} color="#fff" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
          {/* Floating overlay toolbar (TeamViewer-style) — rendered after the
              gesture layer within the same videoWrap parent (like cursorDot/
              toast above) rather than as a normal layout row, so the video
              uses the full screen instead of sharing it with dedicated
              chrome. On Android, RTCView is backed by a SurfaceView, which
              always draws on top of ordinary RN views regardless of
              z-index/order unless the overlay shares its stacking context. */}
          {toolbarCollapsed ? (
            <TouchableOpacity
              style={[styles.expandBtn, { bottom: 8 + insets.bottom }]}
              onPress={() => setToolbarCollapsed(false)}
              accessibilityRole="button"
              accessibilityLabel="Werkbalk uitklappen"
            >
              <ChevronUp size={20} color={colors.muted} strokeWidth={2.4} />
            </TouchableOpacity>
          ) : (
            <View style={[styles.floatingToolbarWrap, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
              <View style={styles.sessionToolbar}>
                {/* Horizontally scrollable so every control (including disconnect)
                    stays reachable even on narrow screens where this cluster would
                    otherwise overflow past the right edge and become untappable. */}
                <ScrollView
                  horizontal
                  style={styles.toolbarActions}
                  contentContainerStyle={styles.toolbarActionsContent}
                  showsHorizontalScrollIndicator={false}
                >
                  {/* One button showing whichever mode is currently active —
                      tapping it opens the Besturing panel, where both the
                      mode toggle and its gesture instructions live (see
                      activePanel === "interactionHelp" below). */}
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "interactionHelp" && styles.toolbarBtnActive]}
                    onPress={() => setActivePanel((p) => (p === "interactionHelp" ? null : "interactionHelp"))}
                    accessibilityRole="button"
                    accessibilityLabel="Besturing"
                  >
                    {toolbarIcon(
                      interactionMode === "touch" ? Hand : MousePointer2,
                      interactionMode === "touch" ? "Tik" : "Muis",
                      activePanel === "interactionHelp"
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "quickActions" && styles.toolbarBtnActive]}
                    onPress={() => setActivePanel((p) => (p === "quickActions" ? null : "quickActions"))}
                    accessibilityRole="button"
                    accessibilityLabel="Snelle acties"
                  >
                    {toolbarIcon(Zap, "Snel", activePanel === "quickActions")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "chat" && styles.toolbarBtnActive]}
                    onPress={openChat}
                    accessibilityRole="button"
                    accessibilityLabel="Chat"
                  >
                    {toolbarIcon(MessageCircle, "Chat", activePanel === "chat")}
                    {hasUnreadChat && <View style={styles.unreadDot} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "files" && styles.toolbarBtnActive]}
                    onPress={() => setActivePanel((p) => (p === "files" ? null : "files"))}
                    accessibilityRole="button"
                    accessibilityLabel="Bestanden"
                  >
                    {toolbarIcon(Folder, "Bestand", activePanel === "files")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "programs" && styles.toolbarBtnActive]}
                    onPress={openProgramsPanel}
                    accessibilityRole="button"
                    accessibilityLabel="Programma's"
                  >
                    {toolbarIcon(AppWindow, "Vensters", activePanel === "programs")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "aiBuddy" && styles.toolbarBtnActive]}
                    onPress={() => setActivePanel((p) => (p === "aiBuddy" ? null : "aiBuddy"))}
                    accessibilityRole="button"
                    accessibilityLabel="AI Buddy"
                  >
                    {toolbarIcon(Sparkles, "AI Buddy", activePanel === "aiBuddy")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.toolbarBtn}
                    onPress={() => setKeyboardVisible((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel="Toetsenbord"
                  >
                    {toolbarIcon(Keyboard, "Bord")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, activePanel === "settings" && styles.toolbarBtnActive]}
                    onPress={() => setActivePanel((p) => (p === "settings" ? null : "settings"))}
                    accessibilityRole="button"
                    accessibilityLabel="Sessie-instellingen"
                  >
                    {toolbarIcon(Settings, "Opties", activePanel === "settings")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toolbarBtn, styles.dangerBtn]}
                    onPress={disconnectSession}
                    accessibilityRole="button"
                    accessibilityLabel="Verbinding verbreken"
                  >
                    {toolbarIcon(Power, "Stop", false, true)}
                  </TouchableOpacity>
                </ScrollView>
                <TouchableOpacity
                  style={styles.collapseBtn}
                  onPress={() => setToolbarCollapsed(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Werkbalk inklappen"
                >
                  <ChevronDown size={20} color={colors.muted} strokeWidth={2.4} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        <Modal visible={activePanel === "settings"} transparent animationType="fade" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>Sessie-instellingen</Text>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Verbinding</Text>
                <Text style={styles.settingsValueText}>
                  {formatId(sessionPeer)}
                  {statsText ? ` · ${statsText}` : ""}
                </Text>
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Kwaliteit</Text>
                <View style={styles.modeToggle}>
                  {(["auto", "high", "low"] as QualityLevel[]).map((level) => (
                    <TouchableOpacity
                      key={level}
                      style={[styles.modeToggleBtn, qualityLevel === level && styles.modeToggleBtnActive]}
                      onPress={() => setQualityLevel(level)}
                    >
                      <Text style={[styles.settingsQualityText, qualityLevel === level && styles.settingsQualityTextActive]}>
                        {level === "auto" ? "Auto" : level === "high" ? "Hoog" : "Laag"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Thema</Text>
                {renderThemeToggle()}
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Externe cursor tonen</Text>
                <Switch
                  value={showRemoteCursor}
                  onValueChange={setShowRemoteCursor}
                  trackColor={{ false: colors.switchOff, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              <View style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>Achtergrond verbergen</Text>
                <Switch
                  value={wallpaperHidden}
                  onValueChange={toggleHideWallpaper}
                  trackColor={{ false: colors.switchOff, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
              {monitors.length > 1 && (
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>Scherm</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monitorScroll}>
                    <View style={styles.modeToggle}>
                      {monitors.map((m) => (
                        <TouchableOpacity
                          key={m.id}
                          style={[styles.modeToggleBtn, activeMonitorId === m.id && styles.modeToggleBtnActive]}
                          onPress={() => switchMonitor(m.id)}
                        >
                          <Text style={[styles.settingsQualityText, activeMonitorId === m.id && styles.settingsQualityTextActive]}>{m.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setActivePanel(null)}>
                <Text style={styles.primaryBtnText}>Sluiten</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "interactionHelp"} transparent animationType="fade" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>Besturing</Text>
              <View style={styles.modeToggle}>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, styles.interactionHelpToggleBtn, interactionMode === "touch" && styles.modeToggleBtnActive]}
                  onPress={() => setInteractionMode("touch")}
                >
                  {modeIcon(Hand, "Tik-modus", interactionMode === "touch")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, styles.interactionHelpToggleBtn, interactionMode === "mouse" && styles.modeToggleBtnActive]}
                  onPress={() => setInteractionMode("mouse")}
                >
                  {modeIcon(MousePointer2, "Muis-modus", interactionMode === "mouse")}
                </TouchableOpacity>
              </View>
              <Text style={styles.interactionHelpIntro}>
                {interactionMode === "mouse"
                  ? "Gebruik je scherm als touchpad om de muis op afstand te besturen."
                  : "Tik direct op de plek op het scherm waar je wilt klikken."}
              </Text>
              <View style={styles.interactionHelpGrid}>
                {(interactionMode === "mouse" ? MOUSE_MODE_GESTURES : TOUCH_MODE_GESTURES).map((g) => (
                  <View key={g.title} style={styles.interactionHelpItem}>
                    <View style={styles.interactionHelpIconWrap}>
                      <g.Icon size={22} color={colors.primary} strokeWidth={2} />
                    </View>
                    <Text style={styles.interactionHelpItemTitle}>{g.title}</Text>
                    <Text style={styles.interactionHelpItemDesc}>{g.desc}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setActivePanel(null)}>
                <Text style={styles.primaryBtnText}>Sluiten</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "quickActions"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>Snelkoppelingen</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel="Sluiten">
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <ScrollView>
                {(
                  [
                    { Icon: Copy, title: "Kopiëren", subtitle: "Ctrl+C", onPress: () => sendShortcut(["ControlLeft", "KeyC"]), danger: false },
                    { Icon: ClipboardPaste, title: "Plakken", subtitle: "Ctrl+V", onPress: () => sendShortcut(["ControlLeft", "KeyV"]), danger: false },
                    { Icon: Camera, title: "Schermafbeelding", subtitle: "PrtScn", onPress: () => sendShortcut(["PrintScreen"]), danger: false },
                    { Icon: AppWindow, title: "Wissel venster", subtitle: "Alt+Tab", onPress: () => sendShortcut(["AltLeft", "Tab"]), danger: false },
                    { Icon: Save, title: "Opslaan", subtitle: "Ctrl+S", onPress: () => sendShortcut(["ControlLeft", "KeyS"]), danger: false },
                    { Icon: Lock, title: "Vergrendelen", subtitle: undefined, onPress: lockRemote, danger: false },
                    { Icon: Keyboard, title: "Ctrl+Alt+Del", subtitle: undefined, onPress: sendCtrlAltDel, danger: false },
                    {
                      Icon: Ban,
                      title: inputBlocked ? "Invoer geblokkeerd" : "Invoer blokkeren",
                      subtitle: undefined,
                      onPress: toggleBlockInput,
                      danger: inputBlocked,
                    },
                    { Icon: RotateCw, title: "Herstarten", subtitle: undefined, onPress: restartRemote, danger: true },
                  ] as const
                ).map((item) => (
                  <TouchableOpacity key={item.title} style={styles.quickActionRow} onPress={item.onPress}>
                    <View style={[styles.interactionHelpIconWrap, item.danger && styles.quickActionIconWrapDanger]}>
                      <item.Icon size={20} color={item.danger ? colors.danger : colors.primary} strokeWidth={2} />
                    </View>
                    <View style={styles.quickActionTextWrap}>
                      <Text style={styles.quickActionTitle}>{item.title}</Text>
                      {item.subtitle && <Text style={styles.quickActionSubtitle}>{item.subtitle}</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "chat"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>Chat</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel="Chat sluiten">
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={chatScrollRef}
                style={styles.chatMessagesList}
                onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
              >
                {chatMessages.length === 0 && <Text style={styles.muted}>Nog geen berichten.</Text>}
                {chatMessages.map((m, i) => (
                  <View key={i} style={[styles.chatBubble, m.fromMe ? styles.chatBubbleMine : styles.chatBubbleTheirs]}>
                    <Text style={styles.chatBubbleText}>{m.text}</Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.chatInputRow}>
                <TextInput
                  style={[styles.input, styles.chatInputField]}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Typ een bericht…"
                  placeholderTextColor="#8b96b8"
                  onSubmitEditing={sendChatMessage}
                  returnKeyType="send"
                />
                <TouchableOpacity style={styles.chatSendBtn} onPress={sendChatMessage}>
                  <Text style={styles.primaryBtnText}>Versturen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "files"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>Bestanden</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel="Bestanden sluiten">
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={sendFilePress}>
                <Text style={styles.primaryBtnText}>Bestand versturen…</Text>
              </TouchableOpacity>
              <ScrollView style={styles.chatMessagesList}>
                {fileTransfers.length === 0 && <Text style={styles.fileEmptyText}>Nog geen bestandsoverdrachten.</Text>}
                {fileTransfers.map((f) => {
                  const pct = f.total > 0 ? Math.min(1, f.received / f.total) : f.done ? 1 : 0;
                  return (
                    <View key={f.id} style={styles.fileRow}>
                      <Text style={styles.fileRowName} numberOfLines={1}>
                        {f.direction === "send" ? "↑ " : "↓ "}
                        {f.name}
                      </Text>
                      <View style={styles.fileProgressTrack}>
                        <View style={[styles.fileProgressFill, { width: `${Math.round(pct * 100)}%` }]} />
                      </View>
                      <Text style={styles.fileRowStatus}>{f.done ? (f.direction === "receive" ? "Opgeslagen in Downloads" : "Verzonden") : `${Math.round(pct * 100)}%`}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "programs"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>Programma's</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel="Programma's sluiten">
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.chatMessagesList}>
                {windowList.length === 0 && <Text style={styles.fileEmptyText}>Geen open programma's gevonden.</Text>}
                {windowList.map((w) => (
                  <TouchableOpacity key={w.id} style={styles.programRow} onPress={() => selectProgram(w)}>
                    {w.thumbnail ? (
                      <Image source={{ uri: w.thumbnail }} style={styles.programThumbnail} resizeMode="cover" />
                    ) : (
                      <View style={[styles.programThumbnail, styles.programThumbnailPlaceholder]}>
                        <AppWindow size={20} color={colors.muted} strokeWidth={2.25} />
                      </View>
                    )}
                    <Text style={styles.programName} numberOfLines={2}>
                      {w.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "aiBuddy"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>AI Buddy</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel="AI Buddy sluiten">
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              {!openaiKeyConfigured ? (
                <Text style={styles.fileEmptyText}>Stel eerst je OpenAI API-sleutel in bij Instellingen op het beginscherm.</Text>
              ) : (
                <>
                  <ScrollView
                    ref={aiBuddyScrollRef}
                    style={styles.chatMessagesList}
                    onContentSizeChange={() => aiBuddyScrollRef.current?.scrollToEnd({ animated: true })}
                  >
                    {aiBuddyLog.length === 0 && (
                      <Text style={styles.muted}>Maak een screenshot van het scherm op afstand en stel een vraag — AI Buddy helpt je stap voor stap.</Text>
                    )}
                    {aiBuddyLog.map((m, i) => (
                      <View key={i} style={[styles.chatBubble, m.role === "user" ? styles.chatBubbleMine : styles.chatBubbleTheirs]}>
                        {m.imageBase64 && <Image source={{ uri: m.imageBase64 }} style={styles.aiBuddyMessageImage} resizeMode="cover" />}
                        <Text style={styles.chatBubbleText}>{m.text}</Text>
                      </View>
                    ))}
                    {aiBuddySending && <Text style={styles.muted}>AI Buddy denkt na…</Text>}
                  </ScrollView>
                  {aiBuddyScreenshot && (
                    <View style={styles.aiBuddyScreenshotPreview}>
                      <Image source={{ uri: aiBuddyScreenshot }} style={styles.aiBuddyScreenshotPreviewImg} resizeMode="cover" />
                      <TouchableOpacity style={styles.aiBuddyScreenshotRemove} onPress={() => setAiBuddyScreenshot(null)}>
                        {toolbarIcon(X)}
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.chatInputRow}>
                    <TouchableOpacity style={styles.toolbarBtn} onPress={takeAiBuddyScreenshot} accessibilityRole="button" accessibilityLabel="Screenshot maken">
                      {toolbarIcon(Camera)}
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.input, styles.chatInputField]}
                      value={aiBuddyInput}
                      onChangeText={setAiBuddyInput}
                      placeholder="Stel een vraag over dit probleem…"
                      placeholderTextColor="#8b96b8"
                      onSubmitEditing={sendAiBuddyMessage}
                      returnKeyType="send"
                      editable={!aiBuddySending}
                    />
                    <TouchableOpacity style={styles.chatSendBtn} onPress={sendAiBuddyMessage} disabled={aiBuddySending}>
                      <Text style={styles.primaryBtnText}>Versturen</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
        {keyboardVisible && (
          <TextInput
            ref={keyboardInputRef}
            style={styles.hiddenInput}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            value={keyboardDraft}
            onChangeText={onKeyboardChangeText}
            onKeyPress={(e) => onKeyboardKeyPress(e.nativeEvent.key)}
            blurOnSubmit={false}
          />
        )}
        {/* Agent confirmations (e.g. Google Antigravity) must stay reachable
            even mid-session — you may be actively controlling a PC when an
            agent on that same PC (or another one) needs your approval. */}
        <Modal visible={!!activeConfirm} transparent animationType="fade">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>{activeConfirm?.title}</Text>
              <Text style={styles.notifySource}>{activeConfirm?.source}</Text>
              <Text style={styles.notifyMessage}>{activeConfirm?.message}</Text>
              {!!activeConfirm?.command && <Text style={styles.notifyCommand}>{activeConfirm.command}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.outlineBtn} onPress={() => answerConfirm("deny")}>
                  <Text style={styles.outlineBtnText}>Weigeren</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => answerConfirm("allow")}>
                  <Text style={styles.primaryBtnText}>Bevestigen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Image source={logo2} style={styles.logo} resizeMode="contain" />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dit apparaat</Text>
          <Text style={styles.label}>Jouw BromeoRemote-ID (voor agent-meldingen)</Text>
          <Text style={styles.mono}>{myId ? formatId(myId) : "—"}</Text>
          <Text style={[styles.statusText, serverStatus === "connected" ? styles.statusOk : styles.statusBad]}>
            {serverStatus === "connected" ? "● Verbonden met server" : serverStatus === "connecting" ? "Verbinden…" : "● Niet verbonden"}
          </Text>
          <Text style={styles.label}>Sessiewachtwoord (verandert bij elke herstart)</Text>
          <Text style={styles.mono}>{hostSessionPassword}</Text>
          <Text style={styles.muted}>Geef dit ID + wachtwoord door aan iemand die deze telefoon op afstand wil bekijken/bedienen.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Weergave</Text>
          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Thema</Text>
            {renderThemeToggle()}
          </View>
          <Text style={styles.muted}>Lichte modus is standaard. Je keuze wordt op dit apparaat onthouden.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bediening op afstand</Text>
          <Text style={styles.muted}>
            Nodig zodat een pc echt kan tikken/vegen op deze telefoon, niet alleen het scherm kan zien. Android vereist hiervoor een
            handmatig ingeschakelde toegankelijkheidsservice.
          </Text>
          <Text style={[styles.statusText, accessibilityEnabled ? styles.statusOk : styles.statusBad]}>
            {accessibilityEnabled ? "● Ingeschakeld" : "● Niet ingeschakeld — schermdelen werkt wel, bediening niet"}
          </Text>
          {!accessibilityEnabled && (
            <TouchableOpacity style={styles.primaryBtn} onPress={openAccessibilitySettings}>
              <Text style={styles.primaryBtnText}>Instellingen openen</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verbinden met een apparaat</Text>
          {savedDevices.length > 0 && (
            <>
              <Text style={styles.label}>Opgeslagen apparaten</Text>
              {savedDevices.map((device) => (
                <View key={device.id} style={styles.savedDeviceRow}>
                  <TouchableOpacity style={styles.savedDeviceMain} onPress={() => connectToSaved(device)}>
                    <Text style={styles.savedDeviceLabel}>{device.label}</Text>
                    <Text style={styles.savedDeviceId}>{formatId(device.id)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.savedDeviceIconBtn}
                    onPress={() => handleToggleFavorite(device.id)}
                    accessibilityLabel={device.favorite ? "Favoriet verwijderen" : "Als favoriet markeren"}
                  >
                    <Star size={18} color={device.favorite ? colors.primary : colors.muted} fill={device.favorite ? colors.primary : "transparent"} strokeWidth={2.2} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.savedDeviceIconBtn}
                    onPress={() => handleRemoveSaved(device.id, device.label)}
                    accessibilityLabel="Apparaat verwijderen"
                  >
                    <Trash2 size={18} color={colors.muted} strokeWidth={2.2} />
                  </TouchableOpacity>
                </View>
              ))}
              <View style={styles.divider} />
            </>
          )}
          <Text style={styles.label}>Partner-ID</Text>
          <TextInput style={styles.input} value={targetId} onChangeText={setTargetId} keyboardType="number-pad" placeholder="bv. 482913650" />
          <Text style={styles.label}>Wachtwoord</Text>
          <TextInput style={styles.input} value={targetPassword} onChangeText={setTargetPassword} secureTextEntry placeholder="Wachtwoord" />
          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Dit apparaat onthouden</Text>
            <Switch
              value={rememberDevice}
              onValueChange={setRememberDevice}
              trackColor={{ false: colors.switchOff, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          {rememberDevice && (
            <TextInput
              style={styles.input}
              value={rememberLabel}
              onChangeText={setRememberLabel}
              placeholder="Naam (bv. Kantoor-pc)"
              placeholderTextColor={colors.muted}
            />
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={onConnectPress}>
            <Text style={styles.primaryBtnText}>Verbinden</Text>
          </TouchableOpacity>
          {!!connectStatus && <Text style={styles.connectStatus}>{connectStatus}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Meldingen</Text>
          <Text style={styles.muted}>
            Bevestigingsverzoeken (bijv. van Google Antigravity) verschijnen als volledig scherm, zelfs als de telefoon
            vergrendeld is.
          </Text>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => openConfirmNotificationSettings()}>
            <Text style={styles.outlineBtnText}>Meldingsgeluid aanpassen</Text>
          </TouchableOpacity>
          {notifications.length === 0 && <Text style={styles.muted}>Nog geen meldingen.</Text>}
          {notifications.map((n) => (
            <View key={n.id} style={styles.notifyRow}>
              <Text style={styles.notifyTitle}>{n.title}</Text>
              <Text style={styles.notifySource}>{n.source}</Text>
              <Text style={styles.notifyMessage}>{n.message}</Text>
              {!!n.command && <Text style={styles.notifyCommand}>{n.command}</Text>}
              {n.status && (
                <Text style={n.status === "allow" ? styles.statusOk : styles.statusBad}>
                  {n.status === "allow" ? "✓ Bevestigd" : "✕ Geweigerd"}
                </Text>
              )}
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI Buddy</Text>
          <Text style={styles.muted}>
            Koppel je eigen OpenAI-sleutel om tijdens een sessie hulp te vragen — maak een screenshot van het scherm op
            afstand en stel een vraag, AI Buddy helpt stap voor stap.
          </Text>
          <Text style={styles.label}>OpenAI API-sleutel</Text>
          <TextInput
            style={styles.input}
            value={openaiKeyInput}
            onChangeText={setOpenaiKeyInput}
            placeholder="sk-…"
            placeholderTextColor="#8b96b8"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={saveOpenAiKey}>
            <Text style={styles.primaryBtnText}>Opslaan</Text>
          </TouchableOpacity>
          <Text style={styles.muted}>{openaiKeyConfigured ? "Sleutel ingesteld." : "Nog geen sleutel ingesteld."}</Text>
        </View>
      </ScrollView>

      <Modal visible={!!activeConfirm} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{activeConfirm?.title}</Text>
            <Text style={styles.notifySource}>{activeConfirm?.source}</Text>
            <Text style={styles.notifyMessage}>{activeConfirm?.message}</Text>
            {!!activeConfirm?.command && <Text style={styles.notifyCommand}>{activeConfirm.command}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => answerConfirm("deny")}>
                <Text style={styles.outlineBtnText}>Weigeren</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => answerConfirm("allow")}>
                <Text style={styles.primaryBtnText}>Bevestigen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!pendingIncoming} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Inkomende verbinding</Text>
            <Text style={styles.notifyMessage}>{pendingIncoming ? formatId(pendingIncoming.fromId) : ""} wil deze telefoon bekijken en bedienen.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => respondToIncoming(false)}>
                <Text style={styles.outlineBtnText}>Weigeren</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => respondToIncoming(true)}>
                <Text style={styles.primaryBtnText}>Toestaan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!totpRequired} transparent animationType="fade" onRequestClose={() => setTotpRequired(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Tweestapsverificatie</Text>
            <Text style={styles.notifyMessage}>
              {totpRequired === "bad-totp" ? "Onjuiste code. Probeer opnieuw." : "Dit apparaat vereist een 6-cijferige code uit je authenticator-app."}
            </Text>
            <TextInput
              style={styles.input}
              value={totpCode}
              onChangeText={setTotpCode}
              placeholder="6-cijferige code"
              placeholderTextColor="#8b96b8"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => setTotpRequired(null)}>
                <Text style={styles.outlineBtnText}>Annuleren</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={submitTotpCode}>
                <Text style={styles.primaryBtnText}>Bevestigen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {toastMessage && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  const colors = themeColors[theme];

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: 20, paddingBottom: 60 },
    logo: { height: 48, width: 240, marginBottom: 20 },
    bootRoot: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
    bootLogo: { height: 58, width: 280, marginBottom: 28 },
    bootSpinner: { marginBottom: 10 },
    bootText: { color: colors.muted, fontSize: 13 },
    card: { backgroundColor: colors.card, borderRadius: 14, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
    cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 10 },
    label: { fontSize: 12, fontWeight: "700", color: colors.muted, marginTop: 10, marginBottom: 4, textTransform: "uppercase" },
    mono: { fontSize: 20, fontWeight: "700", color: colors.text, backgroundColor: colors.field, padding: 10, borderRadius: 8, letterSpacing: 2 },
    statusText: { marginTop: 10, fontSize: 12, fontWeight: "700" },
    statusOk: { color: colors.ok },
    statusBad: { color: colors.bad },
    input: { backgroundColor: colors.field, color: colors.text, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, padding: 12, alignItems: "center", marginTop: 14 },
    primaryBtnText: { color: "#fff", fontWeight: "700" },
    outlineBtn: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, alignItems: "center", marginRight: 10, flex: 1 },
    outlineBtnText: { color: colors.primary, fontWeight: "700" },
    connectStatus: { color: colors.muted, marginTop: 8, fontSize: 12 },
    savedDeviceRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.field, borderRadius: 8, padding: 10, marginBottom: 6 },
    savedDeviceMain: { flex: 1 },
    savedDeviceLabel: { color: colors.text, fontWeight: "700", fontSize: 14 },
    savedDeviceId: { color: colors.muted, fontSize: 11, fontFamily: "monospace", marginTop: 2 },
    savedDeviceIconBtn: { paddingHorizontal: 10, paddingVertical: 4 },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
    muted: { color: colors.muted, fontSize: 13 },
    notifyRow: { backgroundColor: colors.field, borderRadius: 8, padding: 10, marginTop: 8 },
    notifyTitle: { color: colors.text, fontWeight: "700" },
    notifySource: { color: colors.primary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginTop: 2 },
    notifyMessage: { color: colors.muted, fontSize: 13, marginTop: 4 },
    notifyCommand: { color: colors.text, fontFamily: "monospace", fontSize: 12, backgroundColor: colors.codeBg, padding: 8, borderRadius: 6, marginTop: 6 },
    modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
    modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 20 },
    modalActions: { flexDirection: "row", marginTop: 18 },
    chatBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
    chatCard: { backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, height: "60%" },
    chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    chatMessagesList: { flex: 1 },
    chatBubble: { maxWidth: "80%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
    chatBubbleMine: { alignSelf: "flex-end", backgroundColor: colors.bubbleMine },
    chatBubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.bubbleTheirs },
    chatBubbleText: { color: colors.bubbleText, fontSize: 14 },
    chatInputRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
    chatInputField: { flex: 1, marginRight: 8 },
    chatSendBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
    unreadDot: { position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
    fileRow: { backgroundColor: colors.field, borderRadius: 8, padding: 10, marginTop: 8 },
    fileRowName: { color: colors.text, fontWeight: "700", fontSize: 13 },
    fileProgressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 8, overflow: "hidden" },
    fileProgressFill: { height: 4, backgroundColor: colors.primary },
    fileRowStatus: { color: colors.muted, fontSize: 11, marginTop: 6 },
    fileEmptyText: { color: colors.muted, fontSize: 13, marginTop: 12 },
    programRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.field, borderRadius: 8, padding: 10, marginTop: 8 },
    programThumbnail: { width: 48, height: 48, borderRadius: 6, marginRight: 12, backgroundColor: colors.border },
    programThumbnailPlaceholder: { alignItems: "center", justifyContent: "center" },
    programName: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 13 },
    aiBuddyMessageImage: { width: "100%", height: 140, borderRadius: 8, marginBottom: 6 },
    aiBuddyScreenshotPreview: { position: "relative", marginTop: 8, borderRadius: 8, overflow: "hidden" },
    aiBuddyScreenshotPreviewImg: { width: "100%", height: 120 },
    aiBuddyScreenshotRemove: { position: "absolute", top: 6, right: 6, backgroundColor: colors.card, borderRadius: 14, padding: 4 },
    hostBanner: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    hostBannerText: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 20 },
    sessionRoot: { flex: 1, backgroundColor: "#000" },
    // Floats over the bottom of the video (inside videoWrap) instead of taking
    // up its own dedicated row — matches TeamViewer's full-screen-video-with-
    // floating-toolbar layout instead of eating vertical space permanently.
    floatingToolbarWrap: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 15 },
    sessionToolbar: { flexDirection: "row", alignItems: "center", padding: 10, backgroundColor: colors.overlayBg },
    toolbarActions: { flex: 1 },
    toolbarActionsContent: { alignItems: "center", paddingLeft: 8 },
    // Flat by default — no background pill, just a colored icon+label — a
    // filled pill only appears for whichever panel is actually open
    // (toolbarBtnActive) so there's still some indication of open state.
    toolbarBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, marginLeft: 8, minWidth: 48, alignItems: "center" },
    toolbarBtnActive: { backgroundColor: colors.toolbarButton },
    toolbarBtnLabel: { fontSize: 9, fontWeight: "600", marginTop: 3, color: colors.toolbarButton },
    toolbarBtnLabelActive: { color: "#fff" },
    dangerBtn: { backgroundColor: colors.danger },
    modeToggle: { flexDirection: "row", backgroundColor: colors.segmentBg, borderRadius: 8, padding: 2 },
    modeToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignItems: "center" },
    modeToggleBtnActive: { backgroundColor: colors.primary },
    modeToggleBtnLabel: { fontSize: 9, fontWeight: "600", marginTop: 2, color: colors.segmentText },
    modeToggleBtnLabelActive: { color: "#fff" },
    collapseBtn: { paddingHorizontal: 10, paddingVertical: 4, marginLeft: 4 },
    collapseBtnText: { color: colors.muted, fontSize: 16, fontWeight: "700" },
    expandBtn: {
      position: "absolute",
      bottom: 8,
      alignSelf: "center",
      backgroundColor: theme === "dark" ? "rgba(22, 33, 58, 0.85)" : "rgba(255,255,255,0.88)",
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 4,
      zIndex: 10,
    },
    expandBtnText: { color: colors.muted, fontSize: 16, fontWeight: "700" },
    toast: {
      position: "absolute",
      top: 16,
      alignSelf: "center",
      backgroundColor: colors.toastBg,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 8,
      maxWidth: "85%",
      zIndex: 20,
    },
    toastText: { color: "#fff", fontSize: 13, fontWeight: "600", textAlign: "center" },
    toastBelowAppModeBar: { top: 64 },
    appModeBar: {
      position: "absolute",
      top: 16,
      left: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.overlayBg,
      borderRadius: 20,
      paddingLeft: 16,
      paddingRight: 8,
      paddingVertical: 6,
      zIndex: 20,
    },
    appModeBarText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "600", marginRight: 8 },
    appModeCloseBtn: { backgroundColor: colors.danger, borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" },
    settingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
    settingsQualityText: { color: colors.segmentText, fontSize: 12, fontWeight: "700", paddingHorizontal: 4 },
    settingsQualityTextActive: { color: "#fff" },
    monitorScroll: { maxWidth: 180 },
    interactionHelpToggleBtn: { paddingHorizontal: 16, paddingVertical: 8 },
    interactionHelpIntro: { color: colors.muted, fontSize: 13, marginTop: 12, marginBottom: 4, lineHeight: 18 },
    interactionHelpGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, marginHorizontal: -6 },
    interactionHelpItem: { width: "50%", paddingHorizontal: 6, paddingVertical: 10, alignItems: "center" },
    interactionHelpIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.field,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    interactionHelpItemTitle: { color: colors.text, fontSize: 13, fontWeight: "700", textAlign: "center" },
    interactionHelpItemDesc: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 2 },
    quickActionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    quickActionIconWrapDanger: { backgroundColor: "rgba(229,72,77,0.12)" },
    quickActionTextWrap: { marginLeft: 12 },
    quickActionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
    quickActionSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
    settingsLabel: { color: colors.text, fontSize: 14 },
    settingsValueText: { color: colors.muted, fontSize: 12, fontFamily: "monospace", flexShrink: 1, textAlign: "right", marginLeft: 10 },
    videoWrap: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
    videoGestureLayer: { flex: 1 },
    video: { flex: 1 },
    videoZoomed: { position: "absolute" },
    cursorDot: {
      position: "absolute",
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: "#fff",
      backgroundColor: "rgba(59, 123, 253, 0.6)",
    },
    hiddenInput: { position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 10 },
  });
}
