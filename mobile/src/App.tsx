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
  useWindowDimensions,
  Keyboard as RNKeyboard,
  Animated,
  PixelRatio,
} from "react-native";
// react-native's own SafeAreaView is effectively iOS-only in practice (a
// no-op on Android) — this one actually insets for the status bar/notch on
// both platforms, via the SafeAreaProvider wrapping <App/> in index.js.
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RTCView, MediaStream, mediaDevices } from "react-native-webrtc";
import Svg, { Ellipse, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { DEFAULT_SIGNALING_URL, DEFAULT_ICE_SERVERS } from "./shared/config";
import { getLicenseStatus, verifyMobileLicense, type LicenseStatus } from "./license";
import type { AnnotationShape, CursorShapeName, MonitorInfo, NotificationPayload, QualityLevel, ResolutionMode, SavedDevice, ServerMessage, WindowInfo } from "./shared/protocol";
import { sha256Hex } from "./crypto";
import { Signaling } from "./signaling";
import { MobileSession, type CodecPreferenceMode } from "./session";
import { requestNotificationPermission, getPushToken, onPushTokenRefresh, onForegroundPush } from "./push";
import { ensureNotificationChannels, onNotificationPress, getInitialNotificationPress, openConfirmNotificationSettings } from "./notifications";
import { getOpenAiApiKey, setOpenAiApiKey, captureRemoteVideoFrame, askAiBuddy, type AiBuddyMessage } from "./aiBuddy";
import { isAccessibilityServiceEnabled, openAccessibilitySettings } from "./remoteControl";
import { isVirtualKeyboardEnabled, openKeyboardSettings } from "./virtualKeyboard";
import { RemoteInputTranslator } from "./inputTranslator";
import { getSavedDevices, saveDevice, removeSavedDevice, toggleFavorite, sortSavedDevices } from "./savedDevices";
import { getSessionHistory, addSessionHistoryEntry, clearSessionHistory, type SessionHistoryEntry } from "./sessionHistory";
import { useI18n, loadLang, setLang, getLang } from "./i18n";
import { pick, isErrorWithCode, errorCodes } from "@react-native-documents/picker";
import ReactNativeBlobUtil from "react-native-blob-util";
import {
  TapGestureIcon,
  LongPressGestureIcon,
  DragGestureIcon,
  LongPressDragGestureIcon,
  PinchGestureIcon,
  ArrowCursorIcon,
  TextCursorIcon,
  HandCursorIcon,
  MoveCursorIcon,
  ResizeEWCursorIcon,
  ResizeNSCursorIcon,
  ResizeNESWCursorIcon,
  ResizeNWSECursorIcon,
  WaitCursorIcon,
  NotAllowedCursorIcon,
  HelpCursorIcon,
} from "./gestureIcons";
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
  Home,
  Keyboard,
  Lock,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Move,
  MousePointer2,
  MousePointerClick,
  Pencil,
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
  WifiOff,
} from "lucide-react-native";

const logo2 = require("./assets/logo2.png");

const DEVICE_ID_KEY = "bromeoremote_device_id";
const QUALITY_LEVEL_KEY = "bromeoremote_quality_level";
const RENDER_QUALITY_MODE_KEY = "bromeoremote_render_quality_mode";
const CODEC_PREFERENCE_KEY = "bromeoremote_codec_preference";
const RESOLUTION_PREFERENCE_KEY = "bromeoremote_resolution_preference";
const ANNOTATION_COLOR = "#ff3b3b";
const SHOW_CURSOR_KEY = "bromeoremote_show_remote_cursor";
const THEME_KEY = "bromeoremote_theme";

// Mirrors the actual gesture handling in the panResponder below exactly —
// keep in sync if that logic changes.
function buildMouseModeGestures(tFn: (key: string, vars?: Record<string, string | number>) => string) {
  return [
    { id: "tap", Icon: MousePointerClick, title: tFn("gesture.tap.title"), desc: tFn("gesture.tap.mouseDesc") },
    { id: "longPress", Icon: Timer, title: tFn("gesture.longPress.title"), desc: tFn("gesture.longPress.mouseDesc") },
    { id: "drag", Icon: Move, title: tFn("gesture.drag.title"), desc: tFn("gesture.drag.mouseDesc") },
    { id: "doubleTapDrag", Icon: MousePointerClick, title: tFn("gesture.doubleTapDrag.title"), desc: tFn("gesture.doubleTapDrag.mouseDesc") },
    { id: "twoFingerDrag", Icon: ArrowUpDown, title: tFn("gesture.twoFingerDrag.title"), desc: tFn("gesture.twoFingerDrag.mouseDesc") },
    { id: "pinch", Icon: ZoomIn, title: tFn("gesture.pinch.title"), desc: tFn("gesture.pinch.desc") },
  ];
}
function buildTouchModeGestures(tFn: (key: string, vars?: Record<string, string | number>) => string) {
  return [
    { id: "tap", Icon: TapGestureIcon, title: tFn("gesture.tap.title"), desc: tFn("gesture.tap.touchDesc") },
    { id: "doubleTap", Icon: TapGestureIcon, title: tFn("gesture.doubleTap.title"), desc: tFn("gesture.doubleTap.touchDesc") },
    { id: "longPress", Icon: LongPressGestureIcon, title: tFn("gesture.longPress.title"), desc: tFn("gesture.longPress.touchDesc") },
    { id: "fastDrag", Icon: DragGestureIcon, title: tFn("gesture.fastDrag.title"), desc: tFn("gesture.fastDrag.touchDesc") },
    { id: "longPressDrag", Icon: LongPressDragGestureIcon, title: tFn("gesture.longPressDrag.title"), desc: tFn("gesture.longPressDrag.touchDesc") },
    { id: "pinch", Icon: PinchGestureIcon, title: tFn("gesture.pinch.title"), desc: tFn("gesture.pinch.desc") },
  ];
}

type AppTheme = "light" | "dark";
type IconComponent = React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

// Maps the host's reported OS cursor shape (see the "cursor-shape"
// SystemCommand) to the matching overlay icon — see CURSOR_SHAPE_ICONS'
// components in gestureIcons.tsx for why each looks the way it does.
const CURSOR_SHAPE_ICONS: Record<CursorShapeName, IconComponent> = {
  arrow: ArrowCursorIcon,
  hand: HandCursorIcon,
  text: TextCursorIcon,
  move: MoveCursorIcon,
  "resize-ew": ResizeEWCursorIcon,
  "resize-ns": ResizeNSCursorIcon,
  "resize-nesw": ResizeNESWCursorIcon,
  "resize-nwse": ResizeNWSECursorIcon,
  wait: WaitCursorIcon,
  "not-allowed": NotAllowedCursorIcon,
  help: HelpCursorIcon,
};

// Where each icon's real "hotspot" sits within its 24x24 box (see
// moveCursorDotTo) — arrow is the one genuinely pointed shape (its actual
// tip, per ArrowCursorIcon's own doc comment); every other shape here
// renders as a centered symbol (TextCursorIcon's I-beam, or a
// CursorBadgeIcon circle), so their hotspot is just the box center.
const CURSOR_SHAPE_HOTSPOTS: Record<CursorShapeName, { x: number; y: number }> = {
  arrow: { x: 6, y: 2 },
  hand: { x: 12, y: 12 },
  text: { x: 12, y: 12 },
  move: { x: 12, y: 12 },
  "resize-ew": { x: 12, y: 12 },
  "resize-ns": { x: 12, y: 12 },
  "resize-nesw": { x: 12, y: 12 },
  "resize-nwse": { x: 12, y: 12 },
  wait: { x: 12, y: 12 },
  "not-allowed": { x: 12, y: 12 },
  help: { x: 12, y: 12 },
};

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
  const { lang, t } = useI18n();
  // `lang` isn't read directly in these callbacks, but it's what actually changes when the
  // language switches (t's own identity is stable); it must stay in the deps to force a rebuild.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mouseModeGestures = useMemo(() => buildMouseModeGestures(t), [lang, t]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const touchModeGestures = useMemo(() => buildTouchModeGestures(t), [lang, t]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
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
  const [sessionHistory, setSessionHistoryState] = useState<SessionHistoryEntry[]>([]);
  const [sessionHistoryExpanded, setSessionHistoryExpanded] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "instellingen" | "meer">("home");
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
  const filesTransferredCountRef = useRef(0);
  const [totpRequired, setTotpRequired] = useState<"totp-required" | "bad-totp" | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [trustThisDevice, setTrustThisDevice] = useState(false);
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
  const [virtualKeyboardEnabled, setVirtualKeyboardEnabled] = useState(false);
  const roleRef = useRef<"viewer" | "host" | null>(null);
  function setCurrentRole(role: "viewer" | "host" | null): void {
    roleRef.current = role;
    setCurrentRoleState(role);
  }
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    if (!keyboardVisible) {
      setKeyboardDraft("");
      lastKeyboardDraftRef.current = "";
    }
  }, [keyboardVisible]);
  
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
  const lastKeyboardDraftRef = useRef("");
  // Only one of the toolbar's dropdown panels is open at a time (Shortcuts,
  // Quick actions, Settings) — matches TeamViewer's mobile session bar.
  const [activePanel, setActivePanel] = useState<"quickActions" | "settings" | "chat" | "files" | "programs" | "aiBuddy" | "interactionHelp" | null>(null);
  // "Control a program" — pick one of the host's open windows, view/control
  // just that window (resized on the host to match this phone's aspect
  // ratio), instead of the whole desktop.
    const [windowList, setWindowList] = useState<WindowInfo[]>([]);
  const [splitMode, setSplitMode] = useState<boolean>(false);
  const [selectedSplitWindows, setSelectedSplitWindows] = useState<WindowInfo[]>([]);
  const [activeDualWindows, setActiveDualWindows] = useState<{ win1: WindowInfo; win2: WindowInfo } | null>(null);
  const [activeAppWindow, setActiveAppWindow] = useState<{ id: string; name: string } | null>(null);
  // View two whole monitors simultaneously (composited side-by-side/stacked
  // by the host — see "switch-dual-monitor" in shared/protocol.ts), same
  // toggle-then-select-2 UX pattern as splitMode/selectedSplitWindows above.
  const [monitorSplitMode, setMonitorSplitMode] = useState<boolean>(false);
  const [selectedSplitMonitors, setSelectedSplitMonitors] = useState<MonitorInfo[]>([]);
  const [activeDualMonitors, setActiveDualMonitors] = useState<{ m1: MonitorInfo; m2: MonitorInfo } | null>(null);
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
  const [licenseEmailInput, setLicenseEmailInput] = useState("");
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [licenseStatusInfo, setLicenseStatusInfo] = useState<LicenseStatus | null>(null);
  const [licenseVerifying, setLicenseVerifying] = useState(false);

  async function saveOpenAiKey(): Promise<void> {
    const key = openaiKeyInput.trim();
    await setOpenAiApiKey(key || null);
    setOpenaiKeyConfigured(!!key);
    setOpenaiKeyInput("");
    showToast(key ? t("aiBuddy.keySavedToast") : t("aiBuddy.keyRemovedToast"));
  }

  async function takeAiBuddyScreenshot(): Promise<void> {
    const frame = await captureRemoteVideoFrame(rtcViewRef);
    if (!frame) {
      showToast(t("aiBuddy.screenshotFailed"));
      return;
    }
    setAiBuddyScreenshot(frame);
  }

  async function sendAiBuddyMessage(): Promise<void> {
    const text = aiBuddyInput.trim();
    if (!text || aiBuddySending) return;
    if (!(await getOpenAiApiKey())) {
      showToast(t("aiBuddy.keyMissingHint"));
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
        { role: "assistant", text: result.ok && result.reply ? result.reply : `⚠️ ${result.error ?? t("aiBuddy.unknownError")}`, timestamp: Date.now() },
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
              {value === "light" ? t("theme.light") : t("theme.dark")}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  function renderLangToggle(): React.JSX.Element {
    return (
      <View style={styles.modeToggle}>
        {(["en", "nl"] as const).map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.modeToggleBtn, getLang() === value && styles.modeToggleBtnActive]}
            onPress={() => setLang(value)}
          >
            <Text style={[styles.settingsQualityText, getLang() === value && styles.settingsQualityTextActive]}>
              {value === "en" ? "EN" : "NL"}
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
      showToast(t("files.receivedToast", { name }));
    } catch {
      setFileTransfers((prev) => prev.filter((f) => f.id !== id));
      Alert.alert(t("common.failed"), t("files.saveFailedMsg", { name }));
    }
  }

  async function sendFilePress(): Promise<void> {
    if (!sessionRef.current) return;
    let picked: { uri: string; name: string | null; size: number | null }[];
    try {
      picked = await pick({ mode: "open" });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert(t("common.failed"), t("files.pickFailedMsg"));
      return;
    }
    const doc = picked[0];
    const name = doc.name ?? t("files.defaultName");
    const id = `${Date.now()}-out`;
    try {
      const base64: string = await ReactNativeBlobUtil.fs.readFile(doc.uri, "base64");
      setFileTransfers((prev) => [...prev, { id, name, total: doc.size ?? 0, received: doc.size ?? 0, direction: "send", done: false }]);
      await sessionRef.current.sendFile(name, base64);
      setFileTransfers((prev) => prev.map((f) => (f.id === id ? { ...f, done: true } : f)));
      filesTransferredCountRef.current++;
      showToast(t("files.sentToast", { name }));
    } catch {
      setFileTransfers((prev) => prev.filter((f) => f.id !== id));
      Alert.alert(t("common.failed"), t("files.sendFailedMsg", { name }));
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
  // Updates only on genuine hover-context changes on the host (see the
  // "cursor-shape" SystemCommand), not a hot path — plain state/re-render
  // for the *icon itself* is fine here, unlike the cursor dot's own
  // *position* (see cursorAnim). cursorShapeRef exists only because
  // moveCursorDotTo is called from the panResponder's handlers, which are
  // captured once via useRef(PanResponder.create(...)) and would otherwise
  // only ever see the "arrow" value from that first render — same reason
  // zoomRef/virtualCursorRef exist alongside their own state elsewhere here.
  const [cursorShape, setCursorShapeState] = useState<CursorShapeName>("arrow");
  const cursorShapeRef = useRef<CursorShapeName>("arrow");
  function setCursorShape(shape: CursorShapeName): void {
    cursorShapeRef.current = shape;
    setCursorShapeState(shape);
  }
  const [inputBlocked, setInputBlocked] = useState(false);
  const [wallpaperHidden, setWallpaperHidden] = useState(false);
  const [qualityLevel, setQualityLevelState] = useState<QualityLevel>("auto");
  // True while the host's adaptive engine has resorted to scaling down the
  // encode resolution (see ADAPTIVE_RESOLUTION_SCALE_DOWN in the host's
  // session.ts) — surfaced so a soft/blurry picture reads as "your
  // connection is struggling" rather than an unexplained quality bug.
  const [qualityDegraded, setQualityDegraded] = useState(false);
  // --- Annotation/whiteboard overlay (lightweight, ephemeral pointing —
  // see the SystemCommand's own comment in shared/protocol.ts). Phase 1
  // simplification: entering draw mode resets zoom to 1x and stays there,
  // since correctly reverse-mapping a drawn point through the live pinch-
  // zoom transform (getContentRect + scale/panX/panY) back to a stable
  // normalized video-frame coordinate is a real correctness problem this
  // phase deliberately doesn't take on — draw at the default (unzoomed)
  // view only. ---
  const [annotateModeActive, setAnnotateModeActive] = useState(false);
  // Persistent — matches the desktop host's whiteboard (see
  // client/src/renderer/app.ts): shapes stay until an explicit erase/clear,
  // not on a fade timer. Mobile only ever *draws* "pen" shapes itself, but
  // has to render whatever kind the desktop host's toolbox sends.
  const [annotationShapes, setAnnotationShapes] = useState<AnnotationShape[]>([]);
  const currentStrokeRef = useRef<{ id: string; points: { x: number; y: number }[] } | null>(null);
  // Forces a re-render on every touch move so the in-progress local stroke
  // draws live (annotationShapes itself already triggers a render on change).
  const [, setAnnotationTick] = useState(0);
  function toggleAnnotateMode(): void {
    setAnnotateModeActive((active) => {
      if (!active) setZoom({ scale: 1, panX: 0, panY: 0 });
      return !active;
    });
  }
  function clearAnnotationsLocally(): void {
    annotationShapes.length && setAnnotationShapes([]);
    currentStrokeRef.current = null;
  }
  function eraseAnnotationShapeLocally(id: string): void {
    setAnnotationShapes((prev) => prev.filter((s) => s.id !== id));
  }
  // --- Voice intercom — talk to the person at the host machine, separate
  // from the host's one-way system audio (see voiceTransceiver in
  // session.ts). Incoming voice needs no explicit playback wiring here:
  // react-native-webrtc renders any received audio track automatically
  // once it's part of the peer connection, the same way the existing
  // system-audio track already does without any dedicated <audio>-style
  // element in this file. ---
  const [micActive, setMicActive] = useState(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  async function toggleMicrophone(): Promise<void> {
    if (micStreamRef.current) {
      await sessionRef.current?.setMicrophoneTrack(null);
      micStreamRef.current.getTracks().forEach((track: any) => track.stop());
      micStreamRef.current = null;
      setMicActive(false);
      showToast(t("msg.micOff"));
      return;
    }
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream as unknown as MediaStream;
      await sessionRef.current?.setMicrophoneTrack(stream.getAudioTracks()[0]);
      setMicActive(true);
      showToast(t("msg.micOn"));
    } catch {
      showToast(t("msg.micError"));
    }
  }
  function resetMicrophoneState(): void {
    micStreamRef.current?.getTracks().forEach((track: any) => track.stop());
    micStreamRef.current = null;
    setMicActive(false);
  }
  function setQualityLevel(level: QualityLevel): void {
    setQualityLevelState(level);
    AsyncStorage.setItem(QUALITY_LEVEL_KEY, level).catch(() => undefined);
    sessionRef.current?.sendSystemCommand({ kind: "quality-request", level });
  }
  // Controls how big a layout box RTCView's native SurfaceViewRenderer gets
  // to decode/render into — see getZoomTiers' own comment for the full
  // reasoning. "tiered" (default) only grows it when crossing a zoom step,
  // bounding worst-case blur while keeping the average render size (and
  // its GPU/battery/memory cost) low; "always-max" renders at the sharpest
  // possible size for the whole session, trading continuous extra resource
  // use for zero transition steps. A ref mirror because PanResponder.create
  // below captures its handlers once (see the other *Ref mirrors nearby).
  const [renderQualityMode, setRenderQualityModeState] = useState<"tiered" | "always-max">("tiered");
  const renderQualityModeRef = useRef(renderQualityMode);
  function setRenderQualityMode(mode: "tiered" | "always-max"): void {
    renderQualityModeRef.current = mode;
    setRenderQualityModeState(mode);
    AsyncStorage.setItem(RENDER_QUALITY_MODE_KEY, mode).catch(() => undefined);
  }
  // Codec order is only settled once, at the offer that starts a session
  // (see session.ts's startAsViewer/preferScreenContentCodecs) — WebRTC
  // doesn't support changing it live without a full renegotiation, so this
  // is a "pick before connecting" setting, not a live toggle like quality.
  const [codecPreference, setCodecPreferenceState] = useState<CodecPreferenceMode>("sharp");
  function setCodecPreference(mode: CodecPreferenceMode): void {
    setCodecPreferenceState(mode);
    AsyncStorage.setItem(CODEC_PREFERENCE_KEY, mode).catch(() => undefined);
  }
  // Unlike codec, capture resolution isn't settled at connect time — the host
  // just re-runs its screen capture at the new size and swaps the track (same
  // mechanism as switching windows), so this can be a live toggle sent
  // immediately, the same as quality.
  const [resolutionPreference, setResolutionPreferenceState] = useState<ResolutionMode>("sharp");
  function setResolutionPreference(mode: ResolutionMode): void {
    setResolutionPreferenceState(mode);
    AsyncStorage.setItem(RESOLUTION_PREFERENCE_KEY, mode).catch(() => undefined);
    sessionRef.current?.sendSystemCommand({ kind: "resolution-preference", mode });
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
  // Set by the rotation effect below, consumed by videoWrap's onLayout once
  // videoLayoutRef has actually been re-measured for the new orientation —
  // see that effect's own comment for why this can't just send the resize
  // command immediately when rotation is detected.
  const pendingRotationResizeRef = useRef<{ isPortrait: boolean } | null>(null);
  // The actual decoded frame's resolution (from RTCView's onDimensionsChange)
  // — needed to size the video box correctly for the current orientation
  // (see getContentRect below), since the video's aspect ratio can be
  // anything (full desktop, a specific shared window, any monitor
  // resolution) and rarely exactly matches the container's. Without this,
  // tap/cursor percentage math silently assumed the video filled 100% of
  // videoLayoutRef 1:1, which is only true when the aspect ratios happen to
  // match — otherwise every mapped point was off, which is exactly why the
  // mouse-mode cursor dot and the real remote cursor (baked into the video)
  // would land in different spots.
  const videoDimsRef = useRef({ width: 0, height: 0 });
  // Diagnostic-only, from the host's own encoder stats (see
  // "encoder-limitation" in shared/protocol.ts) — read inside onStats to
  // append to the stats line without waiting for its own re-render.
  const encoderLimitationRef = useRef<string | null>(null);
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
    // The dot's on-screen spot is a function of both the cursor's content
    // fraction *and* the current zoom/pan transform — a pinch/pan changes
    // where the same fraction lands on screen even though the cursor
    // itself hasn't logically moved, so it needs refreshing here too (see
    // cursorAnim's doc comment near virtualCursorRef).
    moveCursorDotTo(virtualCursorRef.current.xPct, virtualCursorRef.current.yPct);
  }
  // True for the duration of an active 2-finger pinch. Resizing RTCView's
  // real layout (below) makes Android reallocate the native SurfaceView's
  // render buffer — far heavier than a transform, and firing that on every
  // single pinch-move touch event (up to ~60/s) is what caused the reported
  // lag/overshoot/disappearing. A throttled periodic real-resize *during*
  // the pinch (instead of only once it settles) was tried to reduce how
  // long text stays blurry mid-gesture, but every one of those still
  // reallocated the SurfaceView and was visible as a flicker each time —
  // worse than the blur it was meant to fix. So: cheap transform-scale for
  // the whole live pinch, real (sharp) resize only once it settles.
  const [zoomLive, setZoomLive] = useState(false);
  // Zooming only magnifies the already-decoded frame (see the RTCView
  // transform below) — it doesn't reveal more real detail unless the
  // encoder was already spending enough bits to have that detail there in
  // the first place. So while zoomed in, temporarily ask the host for its
  // highest quality tier — but only when the user's own preference is
  // "low": "auto" is uncapped (WebRTC's own congestion control decides,
  // which is already at least as good as a fixed "high" ceiling) and
  // "high" is already the boost target, so forcing "high" in either of
  // those cases would either do nothing or actively *lower* an uncapped
  // connection's ceiling — the opposite of what zooming in should do.
  const zoomQualityBoostRef = useRef(false);
  useEffect(() => {
    const zoomedIn = zoom.scale > 1.15;
    if (zoomedIn === zoomQualityBoostRef.current) return;
    zoomQualityBoostRef.current = zoomedIn;
    if (qualityLevel === "low") {
      sessionRef.current?.sendSystemCommand({ kind: "quality-request", level: zoomedIn ? "high" : "low" });
    }
    // Independent of the tier-specific boost above: always tells the host's
    // adaptive engine whether the user is currently zoomed in, so "auto"
    // can bias toward sharpness too, not just the manual "low" tier.
    sessionRef.current?.sendSystemCommand({ kind: "zoom-state", zoomedIn });
  }, [zoom.scale, qualityLevel]);
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startCenterX: number;
    startCenterY: number;
    startPanX: number;
    startPanY: number;
    // Tracks the centroid frame-to-frame once classified "pan" (see below),
    // so each move sends an incremental wheel delta — like a real trackpad
    // — instead of one big jump computed against the gesture's start point.
    lastCenterX: number;
    lastCenterY: number;
    // Undecided until either the finger spacing or the centroid has moved
    // enough to tell a pinch from a two-finger pan apart — deliberately a
    // separate "wait and see" state rather than defaulting to one of them,
    // which used to send real scroll-wheel input to the host during the
    // ambiguous first moments of almost every real pinch gesture (they're
    // rarely perfectly symmetric from the very first frame).
    gestureType: "undecided" | "zoom" | "pan";
  } | null>(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  // The render tier locked in for the duration of the current live pinch —
  // see getZoomTiers' comment. Fixed at gesture-grant time and held through
  // the whole gesture so RTCView's layout size never changes mid-pinch (a
  // real resize, the same cost that caused flicker when it happened every
  // touch-move frame); only re-resolved once the gesture settles.
  const liveTierRef = useRef(1);

  function touchDistance(touches: { pageX: number; pageY: number }[]): number {
    return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
  }
  function touchCentroid(touches: { pageX: number; pageY: number }[]): { x: number; y: number } {
    const x = touches.reduce((sum, touch) => sum + touch.pageX, 0) / touches.length;
    const y = touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length;
    return { x, y };
  }
  // Kept wired in case a future react-native-webrtc/Fabric combination
  // makes this actually fire (see the onStats handler above for why it
  // currently doesn't, and why videoDimsRef is populated from getStats
  // instead) — harmless either way, and would just make updates faster if
  // it ever does start working.
  function handleVideoDimensionsChange(e: { nativeEvent: { width: number; height: number } }): void {
    videoDimsRef.current = { width: e.nativeEvent.width, height: e.nativeEvent.height };
  }
  // Where the video box sits within videoLayoutRef, always fitted to the
  // axis the *container's own orientation* pins — not, as a plain
  // objectFit="contain"/"cover" would do, to whichever axis the *video's*
  // aspect ratio happens to be closer to. The video can be anything (full
  // desktop, a specific shared window, any monitor resolution, portrait or
  // landscape) and that's unpredictable, but the user's phone orientation
  // isn't: in portrait the container is taller than it is wide, so the
  // video always fills the full width (any letterbox space only ever lands
  // above/below); in landscape the container is wider than tall, so the
  // video always fills the full height (any pillarbox space only ever
  // lands left/right). This rect is always centered and always <= the
  // container in both dimensions, same as a real letterbox — it's just
  // deliberately never letting the *video's* aspect ratio override which
  // axis that letterboxing happens on. The RTCView render below sizes the
  // actual native view to this rect directly (not objectFit) so this is
  // what's really on screen, not just a touch-mapping approximation.
  function getContentRect(): { x: number; y: number; width: number; height: number } {
    const { width: cw, height: ch } = videoLayoutRef.current;
    const { width: vw, height: vh } = videoDimsRef.current;
    if (!vw || !vh || !cw || !ch) return { x: 0, y: 0, width: cw, height: ch };
    if (ch >= cw) {
      // Portrait container: fill the width, letterbox (if any) top/bottom.
      const height = cw / (vw / vh);
      return { x: 0, y: (ch - height) / 2, width: cw, height };
    }
    // Landscape container: fill the height, pillarbox (if any) left/right.
    const width = ch * (vw / vh);
    return { x: (cw - width) / 2, y: 0, width, height: ch };
  }
  // The video's source resolution is fixed (screen-share capture, not a
  // camera) — zooming in only magnifies already-decoded pixels (see the
  // RTCView transform below), it never reveals more real detail. Past the
  // scale where one source pixel already maps to one physical screen
  // pixel, further zoom is pure blur with zero informational benefit, so
  // cap it there instead of letting pinch/double-tap zoom go arbitrarily
  // far past the point of being readable. Clamped to a sane range in case
  // videoDimsRef isn't populated yet (getStats hasn't reported a resolution
  // for this session yet — see the onStats handler) or reports something
  // degenerate.
  function getMaxZoomScale(): number {
    const rect = getContentRect();
    const { width: vw } = videoDimsRef.current;
    if (!vw || !rect.width) return 4;
    const nativeScale = (vw / rect.width) * PixelRatio.get();
    return Math.min(8, Math.max(2, nativeScale));
  }
  // react-native-webrtc's RTCView on Android is backed by a native
  // SurfaceViewRenderer that decodes/renders at whatever the view's own
  // *layout* size is, not the source resolution — confirmed against the
  // library's own source, no prop exists to decouple them (see the
  // conversation this was researched in). That means a CSS transform-scale
  // (used for zoom) always stretches an already-fixed-resolution bitmap:
  // guaranteed blur, worse the further past 1x layout-size the target zoom
  // is, regardless of the incoming stream's real quality.
  //
  // The fix: render RTCView at a bigger layout size than the screen needs
  // — a "tier" — and use transform *only* to scale that down to whatever
  // the actual target size should be. Downscaling a higher-res render
  // never looks blurry (unlike upscaling a lower-res one), so as long as
  // the current zoom stays within a tier's own range, it stays sharp with
  // zero extra transitions. "tiered" mode only grows the layout size (a
  // real SurfaceView buffer reallocation — the same cost that caused
  // flicker when done every touch-move frame, see zoomLive's own history)
  // when crossing into a new tier, not continuously — bounding worst-case
  // blur to within one tier's range while keeping the *average* render
  // size, and its GPU/battery/memory cost, low. "always-max" instead
  // always uses the single sharpest tier for the whole session — zero
  // transitions/blur ever, at the cost of that higher render size being
  // paid constantly, even fully zoomed out.
  function getZoomTiers(mode: "tiered" | "always-max"): number[] {
    const max = getMaxZoomScale();
    if (mode === "always-max") return [max];
    const steps = [1, 2, 4].filter((tier) => tier < max - 0.01);
    steps.push(max);
    return steps;
  }
  // The smallest tier that's still >= the given scale — i.e. "just enough"
  // render resolution for this zoom level, never less.
  function pickTier(scale: number, tiers: number[]): number {
    return tiers.find((tier) => tier >= scale - 0.001) ?? tiers[tiers.length - 1];
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
  function clampPan(pan: number, scale: number, containerSize: number, contentStart: number, contentSize: number): number {
    const c = containerSize / 2;
    const scaledContentSize = contentSize * scale;
    if (scaledContentSize <= containerSize) {
      // Content fits entirely within the container (e.g. letterboxing). Force it to be centered.
      return c - contentStart - contentSize / 2;
    } else {
      // Content is larger than container. Constrain it so edges don't come into view.
      const maxPan = c * (1 - 1 / scale) - contentStart;
      const minPan = c * (1 + 1 / scale) - (contentStart + contentSize);
      return Math.min(maxPan, Math.max(minPan, pan));
    }
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
    const targetPanX = (lx - cx) / scale - (contentX - cx);
    const targetPanY = (ly - cy) / scale - (contentY - cy);
    return {
      panX: clampPan(targetPanX, scale, width, rect.x, rect.width),
      panY: clampPan(targetPanY, scale, height, rect.y, rect.height),
    };
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


  // --- Mouse mode (trackpad-style relative control, vs. touch mode's
  // absolute tap-to-position) — matches TeamViewer's "Muis-modus". ---
  // Muis-modus is the global default (persisted via AsyncStorage).
  const [interactionMode, setInteractionModeState] = useState<"touch" | "mouse">("mouse");
  const interactionModeRef = useRef<"touch" | "mouse">("mouse");
  function setInteractionMode(mode: "touch" | "mouse"): void {
    interactionModeRef.current = mode;
    setInteractionModeState(mode);
    // Persist preference so it survives app restarts and new sessions
    AsyncStorage.setItem("@interactionMode", mode).catch(() => {});
  }
  // The cursor's logical position (content fraction) — a plain ref, not
  // React state: nothing renders directly from this (the dot's *visual*
  // position is cursorAnim below), it's only read by sendCursorEvent/
  // scroll-into-view/etc. Used to be state, which meant every single
  // touch-move re-rendered this whole (large) component just to move a
  // 20px dot, and fell visibly behind real finger movement under that cost.
  const virtualCursorRef = useRef({ xPct: 0.5, yPct: 0.5 });
  // The dot's actual on-screen position — see virtualCursorRef above for
  // why this is a native-driven Animated value instead of state.
  const cursorAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  function setVirtualCursor(next: { xPct: number; yPct: number }): void {
    virtualCursorRef.current = next;
    moveCursorDotTo(next.xPct, next.yPct);
  }
  // Positions the animated dot for a given content fraction, with the same
  // off-screen clamping the dot's render used to do inline (see
  // contentPctToLocal's doc comment — briefly relevant right after a
  // content-source switch, while zoom/pan still reference the old content).
  function moveCursorDotTo(xPct: number, yPct: number): void {
    const { lx, ly } = contentPctToLocal(xPct, yPct);
    const { width, height } = videoLayoutRef.current;
    const clampedLx = width ? Math.min(width, Math.max(0, lx)) : lx;
    const clampedLy = height ? Math.min(height, Math.max(0, ly)) : ly;
    // Each shape's icon has its own real "hotspot" within its 24x24 box
    // (see CURSOR_SHAPE_HOTSPOTS) — offsetting by that instead of half the
    // box size is what makes the rendered icon land exactly on the logical
    // cursor position, the way a real OS cursor's hotspot is a specific
    // point on it (its tip, for an arrow), not its bounding box's center.
    const hotspot = CURSOR_SHAPE_HOTSPOTS[cursorShapeRef.current];
    cursorAnim.setValue({ x: clampedLx - hotspot.x, y: clampedLy - hotspot.y });
  }
  // Mouse mode's click-drag ("selecteren") arms on the second tap of a
  // double-tap (matches TeamViewer's muis-modus exactly) rather than on a
  // held-still timer — a plain single-finger drag, however slowly it
  // proceeds, now never arms it, however long it takes.
  const mouseGestureRef = useRef({ downTime: 0, buttonDown: false, dragSelectArmed: false, downX: 0, downY: 0 });
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
    // Acceleration curve, not a flat multiplier: slow/deliberate movement
    // stays at true 1:1 (precise targeting, predictable), fast flicks ramp
    // up so crossing a large desktop from a small phone screen doesn't take
    // repeated swipes. Flat 1.8x was too fast even at slow speed (reported
    // as "cursor moves faster than my finger"); flat 1.0x fixed that but
    // made fast movement tedious — this keeps slow movement exactly at 1:1
    // and only speeds up once a move is unambiguously a fast flick, the way
    // real OS pointer acceleration (and TeamViewer's own mouse mode) works.
    const speed = Math.hypot(dxPx, dyPx); // px moved this touch-move event
    const sensitivity = 1 + Math.min(1.3, Math.max(0, speed - 4) / 18);
    const dXPct = (dxPx / width) * sensitivity;
    const dYPct = (dyPx / height) * sensitivity;
    const next = {
      xPct: Math.min(1, Math.max(0, virtualCursorRef.current.xPct + dXPct)),
      yPct: Math.min(1, Math.max(0, virtualCursorRef.current.yPct + dYPct)),
    };

    // Deliberately not setVirtualCursor/setState here — this runs on every
    // single touch-move (up to ~60/s) and a full re-render on each one is
    // exactly what made the dot visibly lag behind the finger (see
    // cursorAnim's doc comment above). The ref stays the source of truth for
    // sendCursorEvent/scroll-into-view; only the dot's own animated value
    // needs to move on every event.
    virtualCursorRef.current = next;

    // Pan-lock: while zoomed in, keep the cursor's SCREEN position fixed by 
    // panning the viewport under it. We do this by calculating the exact pan 
    // needed to keep the new cursor position (contentX/Y) at the center of the 
    // screen (cx/cy). Once pan is at its bound (edge of screen), the clamp 
    // below limits the pan, and the cursor naturally leaves the center to reach 
    // the edge of the desktop.
    const { scale, panX, panY } = zoomRef.current;
    let newPanX = panX;
    let newPanY = panY;
    if (scale > 1.01) {
      const rect = getContentRect();
      const contentX = rect.x + next.xPct * rect.width;
      const contentY = rect.y + next.yPct * rect.height;
      const cx = width / 2;
      const cy = height / 2;
      
      newPanX = clampPan(cx - contentX, scale, width, rect.x, rect.width);
      newPanY = clampPan(cy - contentY, scale, height, rect.y, rect.height);
    }
    
    if (newPanX !== panX || newPanY !== panY) setZoom({ scale, panX: newPanX, panY: newPanY });

    moveCursorDotTo(next.xPct, next.yPct);
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
    isVirtualKeyboardEnabled().then(setVirtualKeyboardEnabled);
    // The only way this actually changes is the user visiting Settings and
    // back (Android has no event for it) — re-check whenever the app returns
    // to the foreground, which covers exactly that path.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        isAccessibilityServiceEnabled().then(setAccessibilityEnabled);
        isVirtualKeyboardEnabled().then(setVirtualKeyboardEnabled);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    getSavedDevices().then((devices) => setSavedDevicesState(sortSavedDevices(devices)));
  }, []);

  useEffect(() => {
    getSessionHistory().then(setSessionHistoryState);
  }, []);

  useEffect(() => {
    getOpenAiApiKey().then((key) => setOpenaiKeyConfigured(!!key));
  }, []);

  useEffect(() => {
    loadLang();
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === "dark" || v === "light") setThemeState(v);
    });
    AsyncStorage.getItem(QUALITY_LEVEL_KEY).then((v) => {
      if (v === "auto" || v === "high" || v === "low") setQualityLevelState(v);
    });
    AsyncStorage.getItem(RENDER_QUALITY_MODE_KEY).then((v) => {
      if (v === "tiered" || v === "always-max") {
        renderQualityModeRef.current = v;
        setRenderQualityModeState(v);
      }
    });
    AsyncStorage.getItem(CODEC_PREFERENCE_KEY).then((v) => {
      if (v === "sharp" || v === "fast") setCodecPreferenceState(v);
    });
    AsyncStorage.getItem(RESOLUTION_PREFERENCE_KEY).then((v) => {
      if (v === "sharp" || v === "fast") setResolutionPreferenceState(v);
    });
    AsyncStorage.getItem(SHOW_CURSOR_KEY).then((v) => {
      if (v !== null) setShowRemoteCursorState(v === "1");
    });
  }, []);

  useEffect(() => {
    getLicenseStatus().then((info) => {
      if (info.licenseEmail) setLicenseEmailInput(info.licenseEmail);
      if (info.licenseKey) setLicenseKeyInput(info.licenseKey);
      setLicenseStatusInfo(info.licenseStatus);
    });
  }, []);

  async function handleVerifyLicense(): Promise<void> {
    const email = licenseEmailInput.trim();
    const key = licenseKeyInput.trim();
    if (!email && !key) {
      showToast(t("license.emailOrKeyRequired"));
      return;
    }
    setLicenseVerifying(true);
    try {
      const res = await verifyMobileLicense(key, email);
      setLicenseStatusInfo(res);
      if (res.valid) {
        showToast(t("license.activatedToast", { email: res.userEmail || email }));
      } else {
        showToast(t("license.failedToast", { reason: res.reason || t("license.unknownError") }));
      }
    } finally {
      setLicenseVerifying(false);
    }
  }

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
              showToast(t("msg.deviceSaved", { label: pending.label }));
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
            offline: t("reason.offline"),
            "bad-password": t("reason.badPassword"),
            declined: t("reason.declined"),
            busy: t("reason.busy"),
          };
          setConnectStatus(reasons[msg.reason ?? ""] ?? t("reason.generic"));
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
        else if (p.sdp?.type === "offer" && roleRef.current === "host") {
          if (sessionRef.current?.hasCaptureStream()) sessionRef.current.answerOffer(p.sdp);
          else captureAndAnswer(p.sdp);
        }
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

  function connectTo(id: string, passwordHash: string, remember: boolean, label: string, totpCodeValue?: string, trustDeviceValue?: boolean): void {
    console.log("[connectTo] called, id=", id);
    console.trace("[connectTo] call stack");
    pendingConnectRef.current = { targetId: id, passwordHash, remember, label };
    lastConnectRef.current = { targetId: id, passwordHash };
    setConnectStatus(t("connect.making"));
    signalingRef.current?.send({
      type: "connect-request",
      targetId: id,
      fromId: myId,
      passwordHash,
      totpCode: totpCodeValue,
      trustDevice: trustDeviceValue,
    });
  }

  function submitTotpCode(): void {
    if (!lastConnectRef.current) return;
    const { targetId: retryId, passwordHash } = lastConnectRef.current;
    const code = totpCode.trim();
    const trust = trustThisDevice;
    setTotpRequired(null);
    setTrustThisDevice(false);
    connectTo(retryId, passwordHash, false, formatId(retryId), code, trust);
  }

  async function onConnectPress(): Promise<void> {
    const cleanTarget = targetId.replace(/\s+/g, "");
    if (!/^\d{9}$/.test(cleanTarget)) {
      setConnectStatus(t("connect.invalidId"));
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
    showToast(t("msg.autoReconnecting", { id: formatId(reconnectId) }));
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
    Alert.alert(t("msg.removeDeviceConfirmTitle", { label }), t("msg.removeDeviceConfirmMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () =>
          removeSavedDevice(id).then((devices) => {
            setSavedDevicesState(sortSavedDevices(devices));
            showToast(t("msg.deviceRemoved"));
          }),
      },
    ]);
  }

  function startViewerSession(peerId: string): void {
    const signaling = signalingRef.current;
    if (!signaling) return;
    setCurrentRole("viewer");
    // Load persisted interaction mode preference (default: mouse)
    AsyncStorage.getItem("@interactionMode").then((saved) => {
      const mode = saved === "touch" ? "touch" : "mouse";
      interactionModeRef.current = mode;
      setInteractionModeState(mode);
    }).catch(() => {
      interactionModeRef.current = "mouse";
      setInteractionModeState("mouse");
    });
    setVirtualCursor({ xPct: 0.5, yPct: 0.5 });
    sessionStartedAtRef.current = Date.now();
    filesTransferredCountRef.current = 0;
    const session = new MobileSession(DEFAULT_ICE_SERVERS, signaling, peerId, {
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setSessionPeer(peerId);
        setInSession(true);
      },
      onConnectionState: (state) => {
        if (state === "closed") {
          console.log("[viewer] connection ended, state=", state, "restartRequestedFor=", restartRequestedForRef.current, "peerId=", peerId);
          // Auto-reconnect only ever fires for the *explicit* "Herstart
          // verbinding" action (restartRequestedFor), never for an
          // unexpected drop — matches client/src/renderer/app.ts.
          const reconnect = restartRequestedForRef.current === peerId ? lastConnectRef.current : null;
          restartRequestedForRef.current = null;
          endSession();
          if (reconnect) {
            console.log("[viewer] scheduling auto-reconnect");
            scheduleAutoReconnect(reconnect.targetId, reconnect.passwordHash);
          }
        }
      },
      onStats: (stats) => {
        // RTCView's onDimensionsChange prop (see getContentRect/
        // handleVideoDimensionsChange) requires a native boolean-enable
        // handshake that doesn't reliably fire under this app's Fabric (New
        // Architecture) setup — react-native-webrtc's ViewManager expects
        // the very same "onDimensionsChange" prop to arrive as a plain
        // boolean to flip its internal enabled flag, which Fabric's
        // codegen'd event props don't do the way the legacy bridge did.
        // getStats' inbound-rtp report already carries frameWidth/
        // frameHeight regardless, and this callback already fires every 2s
        // (see startStatsLoop) — piggybacking on it here is a reliable
        // source for the video's *initial* resolution (before any explicit
        // "video-dimensions" command has ever arrived) instead. Only used
        // as that one-time fallback, not kept live afterward: the host
        // sends an explicit "video-dimensions" command on every real
        // resolution change (switch-window, switch-monitor,
        // switch-dual-window, resize-dual-window, ...), and that's
        // authoritative from then on. Letting this keep overwriting on
        // every 2s poll used to clobber a correct dual-window crop size
        // moments after it arrived — getStats' reported track resolution
        // didn't reliably reflect a just-cropped canvas stream's real
        // dimensions right away, so "briefly correct, then wrong again"
        // was this fallback re-firing on its normal schedule, not a bug in
        // the crop itself.
        if (stats.width != null && stats.height != null && !videoDimsRef.current.width) {
          videoDimsRef.current = { width: stats.width, height: stats.height };
        }
        const parts: string[] = [];
        if (stats.width != null && stats.height != null) parts.push(`${stats.width}×${stats.height}`);
        if (stats.fps != null) parts.push(`${stats.fps} fps`);
        if (stats.bitrateKbps != null) parts.push(`${stats.bitrateKbps} kbps`);
        if (stats.rttMs != null) parts.push(`${stats.rttMs} ms`);
        if (encoderLimitationRef.current && encoderLimitationRef.current !== "none") {
          parts.push(t("stats.limitSuffix", { reason: encoderLimitationRef.current }));
        }
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
          if (cmd.ok) showToast(cmd.enabled ? t("msg.inputBlockedOn") : t("msg.inputBlockedOff"));
          else Alert.alert(t("common.failed"), t("msg.inputBlockFailed"));
        } else if (cmd.kind === "hide-wallpaper-status") {
          setWallpaperHidden(cmd.enabled);
          if (!cmd.ok) Alert.alert(t("common.failed"), t("msg.wallpaperHideFailed"));
        } else if (cmd.kind === "ctrl-alt-del-status") {
          if (cmd.ok) showToast(t("msg.cadSent"));
          else Alert.alert(t("common.failed"), cmd.installed ? t("msg.cadFailed") : t("msg.cadNotEnabled"));
        } else if (cmd.kind === "monitor-list") {
          setMonitors(cmd.monitors);
        } else if (cmd.kind === "window-list") {
          setWindowList(cmd.windows);
        } else if (cmd.kind === "cursor-shape") {
          setCursorShape(cmd.shape);
        } else if (cmd.kind === "adaptive-status") {
          setQualityDegraded(cmd.resolutionScaled);
        } else if (cmd.kind === "encoder-limitation") {
          encoderLimitationRef.current = cmd.reason;
          setStatsText((prev) => prev + " "); // force a re-render, same trick as video-dimensions below
        } else if (cmd.kind === "video-dimensions") {
          videoDimsRef.current = { width: cmd.width, height: cmd.height };
          // Trigger a re-render so the new aspect ratio applies instantly
          // instead of waiting up to 2s for the next getStats poll.
          setStatsText((prev) => prev + " ");
        } else if (cmd.kind === "permissions-update") {
          // Multi-viewer-hosting promotion/demotion on the desktop host's
          // side (desktop-only feature) — mobile doesn't gate its own UI by
          // permission today (the host enforces control server-side
          // regardless), so this is just a heads-up toast, not a UI change.
          showToast(cmd.permissions.control ? t("msg.nowControlling") : t("msg.nowReadOnly"));
        } else if (cmd.kind === "annotation-shape") {
          setAnnotationShapes((prev) => [...prev, cmd.shape]);
        } else if (cmd.kind === "annotation-erase") {
          eraseAnnotationShapeLocally(cmd.id);
        } else if (cmd.kind === "annotation-clear") {
          setAnnotationShapes([]);
          currentStrokeRef.current = null;
        }
      },
    });
    sessionRef.current = session;
    session.startAsViewer(codecPreference);
    // Apply the persisted quality preference to this session too — mirrors
    // the desktop viewer applying its own saved setting right after connecting.
    session.sendSystemCommand({ kind: "quality-request", level: qualityLevel });
    session.sendSystemCommand({ kind: "resolution-preference", mode: resolutionPreference });
    setConnectStatus(t("connect.connected"));
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
        // A "failed"/"disconnected" blip can still self-heal natively — wait
        // for the viewer's own short grace-period close (see session.ts)
        // before tearing down, instead of reacting to the first blip.
        if (state === "disconnected" || state === "failed") return;
        if (state === "closed") endSession();
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
    setAnnotateModeActive(false);
    setAnnotationShapes([]);
    currentStrokeRef.current = null;
    resetMicrophoneState();
    // Mirrors client/src/renderer/app.ts's showSessionSummary() (same
    // wording and the same saved history entry).
    if (sessionStartedAtRef.current != null) {
      const startedAt = sessionStartedAtRef.current;
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      const filesText = filesTransferredCountRef.current === 0 ? t("msg.noFilesTransferred") : t("msg.filesTransferredCount", { count: filesTransferredCountRef.current });
      showToast(t("msg.sessionEndedSummary", { duration: formatDuration(durationSec), files: filesText }));
      addSessionHistoryEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        peerId: sessionPeer,
        startedAt,
        endedAt: Date.now(),
        durationSec,
        filesTransferred: filesTransferredCountRef.current,
      }).then(setSessionHistoryState);
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
    setCursorShape("arrow");
    setQualityDegraded(false);
    setChatMessages([]);
    setHasUnreadChat(false);
    setFileTransfers([]);
    setMonitors([]);
    setActiveMonitorId(null);
    setWindowList([]);
    setActiveAppWindow(null);
    setActiveDualMonitors(null);
    setSelectedSplitMonitors([]);
    setMonitorSplitMode(false);
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
        if (touches.length >= 2) {
          const c = touchCentroid(touches);
          pinchRef.current = {
            startDistance: touchDistance(touches),
            startScale: zoomRef.current.scale,
            startCenterX: c.x,
            startCenterY: c.y,
            startPanX: zoomRef.current.panX,
            startPanY: zoomRef.current.panY,
            lastCenterX: c.x,
            lastCenterY: c.y,
            gestureType: "undecided",
          };
          liveTierRef.current = pickTier(zoomRef.current.scale, getZoomTiers(renderQualityModeRef.current));
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
          mouseGestureRef.current = { downTime: now, buttonDown: false, dragSelectArmed: isSecondTapOfDoubleTap, downX: pageX, downY: pageY };
          return;
        }

        const last = lastTapRef.current;
        const isDoubleTap = now - last.time < 300 && Math.hypot(pageX - last.x, pageY - last.y) < 40;
        lastTapRef.current = { time: now, x: pageX, y: pageY };
        if (isDoubleTap) {
          lastTapRef.current = { time: 0, x: 0, y: 0 }; // consume, avoid a triple-tap re-triggering
          // A real double-click passthrough (two mousedown/mouseup pairs,
          // exactly like a plain single tap doubled up — see the "pending"
          // release-path below) rather than a local zoom gesture, matching
          // real remote-desktop touch mode: double-tap opens things
          // (icons, files), it doesn't zoom. Zoom still has pinch, which
          // works identically in every mode (see onPanResponderGrant's
          // touches.length >= 2 branch above) — this was a redundant
          // shortcut on top of that, not the only way to zoom.
          sendMouseAt("mousedown", pageX, pageY);
          sendMouseAt("mouseup", pageX, pageY);
          sendMouseAt("mousedown", pageX, pageY);
          sendMouseAt("mouseup", pageX, pageY);
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
              lastCenterX: c.x,
              lastCenterY: c.y,
              gestureType: "undecided",
            };
            liveTierRef.current = pickTier(zoomRef.current.scale, getZoomTiers(renderQualityModeRef.current));
            setZoomLive(true);
            // Cancel whatever single-finger action was already in flight
            // from the first finger (a tap/click-drag it can no longer be).
            if (interactionModeRef.current === "mouse") {
              if (mouseGestureRef.current.buttonDown) sendCursorEvent("mouseup");
              mouseGestureRef.current = { downTime: 0, buttonDown: false, dragSelectArmed: false, downX: 0, downY: 0 };
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
            // Two fingers held down and moved together (not pinching).
            // In mouse mode, this scrolls the remote page (sends wheel events).
            // In touch mode, this pans the zoomed-in viewport (moves the screen).
            const deltaX = centroid.x - pinch.lastCenterX;
            const deltaY = centroid.y - pinch.lastCenterY;
            pinch.lastCenterX = centroid.x;
            pinch.lastCenterY = centroid.y;
            
            if (interactionModeRef.current === "touch") {
              const { width, height } = videoLayoutRef.current;
              const rect = getContentRect();
              const prev = zoomRef.current;
              setZoom({
                ...prev,
                panX: clampPan(prev.panX + deltaX / prev.scale, prev.scale, width, rect.x, rect.width),
                panY: clampPan(prev.panY + deltaY / prev.scale, prev.scale, height, rect.y, rect.height),
              });
            } else {
              if (deltaX !== 0 || deltaY !== 0) {
                sessionRef.current?.sendInput({ kind: "wheel", deltaX: -deltaX / 4, deltaY: -deltaY / 4 });
              }
            }
            return;
          }

          // Anchored to the pinch's fixed starting point, not the live
          // (drifting) centroid — real pinches rarely stay perfectly
          // centered, and re-anchoring to the moving centroid made the image
          // visibly scroll/drift during an ordinary pinch. maxPanX/Y
          // (derived from scale) already keeps panning in bounds at any
          // zoom level; getMaxZoomScale caps scale itself so pinching past
          // the video's real resolution doesn't just zoom into unreadable
          // blur (see its own doc comment).
          const newScale = Math.min(getMaxZoomScale(), Math.max(1, pinch.startScale * ratio));
          const { xPct, yPct } = pageToContentPct(pinch.startCenterX, pinch.startCenterY);
          setZoom({ scale: newScale, ...panToKeepContentAt(xPct, yPct, pinch.startCenterX, pinch.startCenterY, newScale) });
          return;
        }

        if (interactionModeRef.current === "mouse") {
          const { pageX, pageY } = evt.nativeEvent;
          const last = lastTouchRef.current;
          moveVirtualCursor(pageX - last.x, pageY - last.y);
          const gesture = mouseGestureRef.current;
          // Only counts as "moved" (which suppresses the tap/long-press
          // click on release) past a small deadzone from the actual touch-
          // down point — without this, a finger that trembles even 1-2px
          // during an otherwise-still tap or long-press would silently
          // never register as a click, since PanResponder fires a move
          // event for any nonzero delta, however tiny. The cursor itself
          // still tracks every event with zero added lag; only the
          // click-vs-drag decision gets the deadzone.
          const driftFromDown = Math.hypot(pageX - gesture.downX, pageY - gesture.downY);
          lastTouchRef.current = { x: pageX, y: pageY, time: last.time, moved: last.moved || driftFromDown > 4 };
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
          mouseGestureRef.current = { downTime: 0, buttonDown: false, dragSelectArmed: false, downX: 0, downY: 0 };
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
    const last = lastKeyboardDraftRef.current;
    if (text.length > last.length) {
      const added = text.slice(last.length);
      sessionRef.current?.sendInput({ kind: "text", value: added });
    }
    lastKeyboardDraftRef.current = text;
    setKeyboardDraft(text);
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
    showToast(t("msg.lockRequested"));
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
    setActiveDualMonitors(null);
    setActiveAppWindow(null);
    sessionRef.current?.sendSystemCommand({ kind: "switch-monitor", monitorId });
    resetZoomAndCursorForNewSource();
  }
  function toggleSplitMonitorSelection(m: MonitorInfo): void {
    const isAlreadySelected = selectedSplitMonitors.some((x) => x.id === m.id);
    let updated: MonitorInfo[];
    if (isAlreadySelected) {
      updated = selectedSplitMonitors.filter((x) => x.id !== m.id);
    } else if (selectedSplitMonitors.length >= 2) {
      updated = [selectedSplitMonitors[1], m];
    } else {
      updated = [...selectedSplitMonitors, m];
    }
    setSelectedSplitMonitors(updated);

    if (updated.length === 2) {
      const m1 = updated[0];
      const m2 = updated[1];
      const isPort = windowHeight > windowWidth;
      sessionRef.current?.sendSystemCommand({
        kind: "switch-dual-monitor",
        monitorId1: m1.id,
        monitorId2: m2.id,
        aspect: videoContainerAspect(),
        isPortrait: isPort,
      });
      setActiveDualMonitors({ m1, m2 });
      // Reuses the same "close" affordance/reset path as single/dual-window
      // mode (activeAppWindow && <close button> -> closeProgramMode) rather
      // than building a separate one.
      setActiveAppWindow({ id: "dual-monitor", name: `${m1.label} + ${m2.label}` });
      resetZoomAndCursorForNewSource();
    }
  }
  function currentPhoneAspect(): number {
    const { width, height } = Dimensions.get("window");
    return width / height;
  }
  // The aspect the host should actually crop/size a shared window to — the
  // *video container's own* measured size (videoLayoutRef, from its
  // onLayout), not the full device screen. Dimensions.get("window") always
  // includes the top/bottom toolbars, which are shorter than a full-height
  // bar but still real space the video never actually renders into — a
  // "perfectly phone-shaped" crop based on the full screen therefore always
  // came out slightly taller than the space it had to fit into, spilling a
  // sliver behind the (opaque) toolbars top and bottom. Falls back to the
  // full-device aspect only before the container has ever been laid out
  // (e.g. the very first frame of a session).
  // The aspect the host should actually crop/size a shared window to — the
  // *video container's own* measured size (videoLayoutRef, from its
  // onLayout), not the full device screen. Dimensions.get("window") always
  // includes the top/bottom bars; videoWrap now correctly excludes them too
  // (they're real flex siblings, not overlays — see portraitTopBar/
  // portraitBottomBar's own style comments), so this can just use the
  // container's measured size directly. Falls back to the full-device
  // aspect only before the container has ever been laid out (e.g. the very
  // first frame of a session).
  function videoContainerAspect(): number {
    const { width, height } = videoLayoutRef.current;
    return width && height ? width / height : currentPhoneAspect();
  }
  // Window lists change far more often than monitor lists (programs
  // open/close constantly), so unlike monitors this is fetched fresh
  // on-demand rather than pushed once at session start.
  function openProgramsPanel(): void {
    sessionRef.current?.sendSystemCommand({ kind: "window-list-request" });
    setSelectedSplitWindows([]);
    setActivePanel("programs");
  }
  function selectProgram(win: WindowInfo): void {
    setActiveDualWindows(null);
    sessionRef.current?.sendSystemCommand({ kind: "switch-window", windowId: win.id, aspect: videoContainerAspect() });
    setActiveAppWindow({ id: win.id, name: win.name });
    setActivePanel(null);
    resetZoomAndCursorForNewSource();
  }

  function toggleSplitWindowSelection(win: WindowInfo): void {
    const isAlreadySelected = selectedSplitWindows.some((w) => w.id === win.id);
    let updated: WindowInfo[];
    if (isAlreadySelected) {
      updated = selectedSplitWindows.filter((w) => w.id !== win.id);
    } else {
      if (selectedSplitWindows.length >= 2) {
        updated = [selectedSplitWindows[1], win];
      } else {
        updated = [...selectedSplitWindows, win];
      }
    }
    setSelectedSplitWindows(updated);

    if (updated.length === 2) {
      const win1 = updated[0];
      const win2 = updated[1];
      const isPort = windowHeight > windowWidth;
      sessionRef.current?.sendSystemCommand({
        kind: "switch-dual-window",
        windowId1: win1.id,
        windowId2: win2.id,
        aspect: videoContainerAspect(),
        isPortrait: isPort,
      });
      setActiveDualWindows({ win1, win2 });
      setActiveAppWindow({ id: "dual", name: `${win1.name} + ${win2.name}` });
      setActivePanel(null);
      resetZoomAndCursorForNewSource();
    }
  }

  function closeProgramMode(): void {
    sessionRef.current?.sendSystemCommand({ kind: "switch-to-desktop" });
    setActiveAppWindow(null);
    setActiveDualWindows(null);
    setSelectedSplitWindows([]);
    setActiveDualMonitors(null);
    setSelectedSplitMonitors([]);
    resetZoomAndCursorForNewSource();
  }
  // While controlling a specific program, keep asking the host to resize
  // that window to match the phone's current aspect ratio as it's rotated —
  // "portrait houd = portrait venster, opzij houd = landscape venster".
  // Deliberately doesn't send the resize command from here directly: at the
  // moment this "change" event fires, videoLayoutRef is still whatever it
  // was for the *previous* orientation — its own update (videoWrap's
  // onLayout, below) goes through an async measureInWindow round-trip that
  // hasn't necessarily completed yet. Sending videoContainerAspect() right
  // here was computing it from stale (pre-rotation) numbers — right
  // isPortrait flag, wrong aspect, which is exactly what produced a
  // portrait-shaped crop while already rotated to landscape. Recording the
  // *intent* here and letting videoWrap's onLayout fire the actual command
  // once it has genuinely fresh numbers fixes that race.
  useEffect(() => {
    if (!activeAppWindow && !activeDualWindows) return;
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      const isPort = window.height > window.width;
      pendingRotationResizeRef.current = { isPortrait: isPort };
    });
    return () => sub.remove();
  }, [activeAppWindow, activeDualWindows, activeDualMonitors]);
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
      t("msg.restartConfirmTitle"),
      t("msg.restartConfirmMsg", { peer: formatId(sessionPeer) }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.restart"),
          style: "destructive",
          onPress: () => {
            sessionRef.current?.sendSystemCommand({ kind: "restart-request" });
            restartRequestedForRef.current = sessionPeer;
            setActivePanel(null);
            showToast(t("msg.restartRequested"));
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
        <Text style={styles.bootText}>{t("boot.connecting")}</Text>
      </SafeAreaView>
    );
  }

  if (inSession && currentRole === "host") {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} />
        <View style={styles.hostBanner}>
          <Text style={styles.hostBannerText}>{t("host.watching", { peer: formatId(sessionPeer) })}</Text>
          <TouchableOpacity style={[styles.primaryBtn, styles.dangerBtn]} onPress={disconnectSession}>
            <Text style={styles.primaryBtnText}>{t("host.endSession")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (inSession) {
    const isAiBuddyOpen = activePanel === "aiBuddy";

    const renderAiBuddyContent = () => (
      <View style={styles.aiBuddyCardInner}>
        <View style={styles.chatHeader}>
          <Text style={styles.cardTitle}>{t("aiBuddy.title")}</Text>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel={t("aiBuddy.closeA11y")}>
            {toolbarIcon(X)}
          </TouchableOpacity>
        </View>
        {!openaiKeyConfigured ? (
          <Text style={styles.fileEmptyText}>{t("aiBuddy.keyMissingHint")}</Text>
        ) : (
          <>
            <ScrollView
              ref={aiBuddyScrollRef}
              style={styles.chatMessagesList}
              onContentSizeChange={() => aiBuddyScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {aiBuddyLog.length === 0 && (
                <Text style={styles.muted}>{t("aiBuddy.emptyHint")}</Text>
              )}
              {aiBuddyLog.map((m, i) => (
                <View key={i} style={[styles.chatBubble, m.role === "user" ? styles.chatBubbleMine : styles.chatBubbleTheirs]}>
                  {m.imageBase64 && <Image source={{ uri: m.imageBase64 }} style={styles.aiBuddyMessageImage} resizeMode="cover" />}
                  <Text style={styles.chatBubbleText}>{m.text}</Text>
                </View>
              ))}
              {aiBuddySending && <Text style={styles.muted}>{t("aiBuddy.thinking")}</Text>}
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
              <TouchableOpacity style={styles.toolbarBtn} onPress={takeAiBuddyScreenshot} accessibilityRole="button" accessibilityLabel={t("aiBuddy.screenshotA11y")}>
                {toolbarIcon(Camera)}
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.chatInputField]}
                value={aiBuddyInput}
                onChangeText={setAiBuddyInput}
                placeholder={t("aiBuddy.placeholder")}
                placeholderTextColor="#8b96b8"
                onSubmitEditing={sendAiBuddyMessage}
                returnKeyType="send"
                editable={!aiBuddySending}
              />
              <TouchableOpacity style={styles.chatSendBtn} onPress={sendAiBuddyMessage} disabled={aiBuddySending}>
                <Text style={styles.primaryBtnText}>{t("common.send")}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );

    return (
      <SafeAreaView style={[styles.sessionRoot, { marginBottom: keyboardHeight }]} edges={["top"]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.sessionColumn}>
          {/* ── Portrait: TOP bar (Vensters · AI Buddy · Opties · Stop) ─────
              A real flex sibling now (see portraitTopBar's own style comment
              for why it wasn't before), placed here so it's first in the
              column and actually pushes sessionContainer/videoWrap down
              instead of floating on top of it. */}
          {!isLandscape && (
            <View style={[styles.portraitTopBar, { paddingLeft: insets.left, paddingRight: insets.right }]}>
              {/* Vensters dropdown */}
              <TouchableOpacity
                style={[styles.portraitTopBtn, activePanel === "programs" && styles.portraitTopBtnActive]}
                onPress={openProgramsPanel}
                accessibilityRole="button"
                accessibilityLabel={t("toolbar.windowsA11y")}
              >
                <AppWindow size={20} color={activePanel === "programs" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
                <Text style={[styles.portraitTopBtnLabel, activePanel === "programs" && styles.portraitTopBtnLabelActive]}>{t("toolbar.windows")}</Text>
              </TouchableOpacity>

              <View style={styles.portraitTopSpacer} />

              {/* AI Buddy */}
              <TouchableOpacity
                style={[styles.portraitTopBtn, activePanel === "aiBuddy" && styles.portraitTopBtnActive]}
                onPress={() => setActivePanel((p) => (p === "aiBuddy" ? null : "aiBuddy"))}
                accessibilityRole="button"
                accessibilityLabel={t("aiBuddy.title")}
              >
                <Sparkles size={20} color={activePanel === "aiBuddy" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
                <Text style={[styles.portraitTopBtnLabel, activePanel === "aiBuddy" && styles.portraitTopBtnLabelActive]}>{t("aiBuddy.title")}</Text>
              </TouchableOpacity>

              {/* Opties */}
              <TouchableOpacity
                style={[styles.portraitTopBtn, activePanel === "settings" && styles.portraitTopBtnActive]}
                onPress={() => setActivePanel((p) => (p === "settings" ? null : "settings"))}
                accessibilityRole="button"
                accessibilityLabel={t("toolbar.options")}
              >
                <Settings size={20} color={activePanel === "settings" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
                <Text style={[styles.portraitTopBtnLabel, activePanel === "settings" && styles.portraitTopBtnLabelActive]}>{t("toolbar.options")}</Text>
              </TouchableOpacity>

              {/* Stop */}
              <TouchableOpacity
                style={[styles.portraitTopBtn, styles.portraitTopBtnDanger]}
                onPress={disconnectSession}
                accessibilityRole="button"
                accessibilityLabel={t("toolbar.disconnectA11y")}
              >
                <Power size={20} color="#fff" strokeWidth={2.2} />
                <Text style={[styles.portraitTopBtnLabel, styles.portraitTopBtnLabelActive]}>{t("toolbar.stop")}</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={[styles.sessionContainer, isLandscape && styles.sessionContainerLandscape]}>
          {isLandscape && isAiBuddyOpen && (
            <View style={[styles.aiBuddyLandscapePanel, { paddingTop: insets.top, paddingLeft: Math.max(insets.left, 12), paddingBottom: Math.max(insets.bottom, 12) }]}>
              {renderAiBuddyContent()}
            </View>
          )}
          <View
            ref={videoWrapRef}
            style={[styles.videoWrap, isAiBuddyOpen && !isLandscape && styles.videoWrapPortraitWithAi]}
            onLayout={() => {
              videoWrapRef.current?.measureInWindow((x, y, width, height) => {
                videoLayoutRef.current = { x, y, width, height };
                // See the rotation effect's own comment — this is the first
                // point after a rotation where videoContainerAspect() is
                // actually trustworthy (genuinely re-measured, not stale),
                // so this is where a pending rotation-triggered resize
                // command actually gets sent, not from the rotation event
                // itself.
                const pending = pendingRotationResizeRef.current;
                if (pending && width && height) {
                  pendingRotationResizeRef.current = null;
                  if (activeDualWindows) {
                    sessionRef.current?.sendSystemCommand({ kind: "resize-dual-window", aspect: videoContainerAspect(), isPortrait: pending.isPortrait });
                  } else if (activeDualMonitors) {
                    sessionRef.current?.sendSystemCommand({ kind: "resize-dual-monitor", aspect: videoContainerAspect(), isPortrait: pending.isPortrait });
                  } else if (activeAppWindow) {
                    sessionRef.current?.sendSystemCommand({ kind: "resize-active-window", aspect: videoContainerAspect() });
                  }
                }
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
                // See getZoomTiers' comment for the full "why": RTCView's
                // native renderer decodes at its own *layout* size, so
                // zooming via a plain transform on a 1x-sized box always
                // upscales an already-fixed-resolution bitmap (blurry). The
                // box below is instead laid out at `tier` size (>= the
                // current zoom, chosen by getZoomTiers/pickTier) — high
                // enough to stay sharp — positioned so its *center* lands
                // exactly where the real target scale/pan says it should
                // (independent of tier, verified algebraically against
                // contentPctToLocal's own formula), then transform-scaled
                // *down* to the real target size. Downscaling never looks
                // blurry, unlike upscaling, so this stays sharp within a
                // tier's whole range. `tier` is locked for the duration of
                // a live pinch (liveTierRef) so the layout size — and thus
                // the expensive SurfaceView reallocation it triggers —
                // never changes mid-gesture (that's what caused visible
                // flicker the one time a real per-frame resize was tried);
                // it only changes on grant (new gesture) or once a gesture
                // settles, exactly like a real resize already only
                // happened on release before this.
                const { width, height } = videoLayoutRef.current;
                if (!width || !height) {
                  return (
                    <RTCView
                      ref={rtcViewRef}
                      streamURL={remoteStream.toURL()}
                      style={styles.video}
                      objectFit="cover"
                      onDimensionsChange={handleVideoDimensionsChange}
                    />
                  );
                }
                // The box the video actually renders in, per the current
                // phone orientation (see getContentRect) — deliberately
                // sized/positioned explicitly rather than left to
                // objectFit, since objectFit's contain/cover only ever
                // compare the *video's* aspect ratio against the
                // container's, and can't guarantee "letterbox only ever
                // lands top/bottom in portrait, pillarbox only ever left/
                // right in landscape" the way this app wants regardless of
                // what's being shared (full desktop vs. a specific window,
                // any monitor resolution).
                const rect = getContentRect();
                const { scale, panX, panY } = zoom;
                const rawTier = zoomLive ? liveTierRef.current : pickTier(scale, getZoomTiers(renderQualityMode));
                // Clamp tier to prevent the physical SurfaceView from exceeding Android's max OpenGL texture
                // size. If layout DP width goes too high (e.g., 6000 DP = 18000px), Android renders a black screen.
                const safeTier = Math.min(rawTier, Math.max(1, 2000 / Math.max(rect.width, rect.height)));
                const tierWidth = rect.width * safeTier;
                const tierHeight = rect.height * safeTier;
                const boxCenterX = width / 2 + scale * panX;
                const boxCenterY = height / 2 + scale * panY;
                return (
                  <RTCView
                    ref={rtcViewRef}
                    streamURL={remoteStream.toURL()}
                    style={[
                      styles.videoZoomed,
                      {
                        left: boxCenterX - tierWidth / 2,
                        top: boxCenterY - tierHeight / 2,
                        width: tierWidth,
                        height: tierHeight,
                        transform: [{ scale: scale / safeTier }],
                      },
                    ]}
                    objectFit="cover"
                    onDimensionsChange={handleVideoDimensionsChange}
                  />
                );
              })()}
            {interactionMode === "mouse" &&
              showRemoteCursor &&
              (() => {
                // Position comes entirely from cursorAnim (see its doc
                // comment near virtualCursorRef) — moveCursorDotTo already
                // applies the same off-screen clamping this used to do
                // inline here, plus the current shape's hotspot offset, so
                // there's nothing left to compute at render time.
                const CursorIcon = CURSOR_SHAPE_ICONS[cursorShape];
                return (
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.cursorDot, { transform: [{ translateX: cursorAnim.x }, { translateY: cursorAnim.y }] }]}
                  >
                    <CursorIcon size={24} />
                  </Animated.View>
                );
              })()}
          </View>
          {(annotateModeActive || annotationShapes.length > 0) &&
            (() => {
              const rect = getContentRect();
              const current = currentStrokeRef.current;
              const renderShape = (s: AnnotationShape) => {
                if (s.kind === "pen" || s.kind === "highlighter") {
                  const points = s.points ?? [];
                  if (points.length < 2) return null;
                  return (
                    <Polyline
                      key={s.id}
                      points={points.map((p) => `${p.x * rect.width},${p.y * rect.height}`).join(" ")}
                      fill="none"
                      stroke={s.color}
                      strokeOpacity={s.kind === "highlighter" ? 0.35 : 1}
                      strokeWidth={s.kind === "highlighter" ? 14 : 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                }
                if (s.kind === "rect") {
                  return (
                    <Rect
                      key={s.id}
                      x={(s.x ?? 0) * rect.width}
                      y={(s.y ?? 0) * rect.height}
                      width={(s.w ?? 0) * rect.width}
                      height={(s.h ?? 0) * rect.height}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={3}
                    />
                  );
                }
                if (s.kind === "ellipse") {
                  return (
                    <Ellipse
                      key={s.id}
                      cx={((s.x ?? 0) + (s.w ?? 0) / 2) * rect.width}
                      cy={((s.y ?? 0) + (s.h ?? 0) / 2) * rect.height}
                      rx={Math.abs((s.w ?? 0) * rect.width) / 2}
                      ry={Math.abs((s.h ?? 0) * rect.height) / 2}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={3}
                    />
                  );
                }
                if (s.kind === "text" || s.kind === "comment") {
                  return (
                    <SvgText
                      key={s.id}
                      x={(s.x ?? 0) * rect.width}
                      y={(s.y ?? 0) * rect.height + 16}
                      fill={s.kind === "comment" ? "#fff" : s.color}
                      fontSize={s.kind === "comment" ? 13 : 18}
                      fontWeight="600"
                    >
                      {s.text}
                    </SvgText>
                  );
                }
                return null;
              };
              return (
                <View
                  pointerEvents={annotateModeActive ? "auto" : "none"}
                  style={[styles.annotationOverlay, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
                  onStartShouldSetResponder={() => annotateModeActive}
                  onResponderGrant={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    currentStrokeRef.current = {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                      points: [{ x: locationX / rect.width, y: locationY / rect.height }],
                    };
                    setAnnotationTick((n) => n + 1);
                  }}
                  onResponderMove={(e) => {
                    if (!currentStrokeRef.current) return;
                    const { locationX, locationY } = e.nativeEvent;
                    currentStrokeRef.current.points.push({ x: locationX / rect.width, y: locationY / rect.height });
                    setAnnotationTick((n) => n + 1);
                  }}
                  onResponderRelease={() => {
                    const stroke = currentStrokeRef.current;
                    currentStrokeRef.current = null;
                    if (!stroke || stroke.points.length < 2) return;
                    const shape: AnnotationShape = { id: stroke.id, kind: "pen", color: ANNOTATION_COLOR, points: stroke.points };
                    setAnnotationShapes((prev) => [...prev, shape]);
                    sessionRef.current?.sendSystemCommand({ kind: "annotation-shape", shape });
                  }}
                >
                  <Svg width="100%" height="100%">
                    {annotationShapes.map(renderShape)}
                    {current && current.points.length >= 2 && (
                      <Polyline
                        points={current.points.map((p) => `${p.x * rect.width},${p.y * rect.height}`).join(" ")}
                        fill="none"
                        stroke={ANNOTATION_COLOR}
                        strokeWidth={3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </Svg>
                </View>
              );
            })()}
          {toastMessage && (
            <View pointerEvents="none" style={styles.toast}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          )}
          {qualityDegraded && (
            <View pointerEvents="none" style={styles.qualityBadge}>
              <WifiOff size={13} color="#fff" strokeWidth={2.4} />
              <Text style={styles.qualityBadgeText}>{t("quality.weakBadge")}</Text>
            </View>
          )}
          {activeAppWindow && (
            // Just the close action — no name label/bar. videoWrap now
            // correctly starts below the real top bar (see its own comment),
            // so this only needs to clear qualityBadge (top-right); placing
            // it top-left avoids that without needing any nudge logic.
            <TouchableOpacity
              style={styles.appModeCloseBtn}
              onPress={closeProgramMode}
              accessibilityRole="button"
              accessibilityLabel={t("portrait.programCloseA11y", { name: activeAppWindow.name })}
            >
              <X size={16} color="#fff" strokeWidth={2.5} />
            </TouchableOpacity>
          )}
          {/* Floating overlay toolbar */}
        </View>
        {!isLandscape && isAiBuddyOpen && (
          <View style={[styles.aiBuddyPortraitPanel, { paddingBottom: 64 + Math.max(insets.bottom, 4) }]}>
            {renderAiBuddyContent()}
          </View>
        )}
        </View>

        {/* ── Portrait: BOTTOM bar (Muis · Bestand · Snel · Bord · Chat) ── */}
        {!isLandscape && (
          <View style={[styles.portraitBottomBar, { paddingBottom: Math.max(insets.bottom, 4), paddingLeft: insets.left, paddingRight: insets.right }]}>
            {/* Muis / Touch modus */}
            <TouchableOpacity
              style={[styles.portraitBottomBtn, activePanel === "interactionHelp" && styles.portraitBottomBtnActive]}
              onPress={() => setActivePanel((p) => (p === "interactionHelp" ? null : "interactionHelp"))}
              accessibilityRole="button"
              accessibilityLabel={t("portrait.controlModeA11y")}
            >
              {interactionMode === "touch"
                ? <Hand size={22} color={activePanel === "interactionHelp" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
                : <MousePointer2 size={22} color={activePanel === "interactionHelp" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />}
              <Text numberOfLines={1} style={[styles.portraitBottomBtnLabel, activePanel === "interactionHelp" && styles.portraitBottomBtnLabelActive]}>
                {interactionMode === "touch" ? t("portrait.touch") : t("toolbar.mouse")}
              </Text>
            </TouchableOpacity>

            {/* Bestand */}
            <TouchableOpacity
              style={[styles.portraitBottomBtn, activePanel === "files" && styles.portraitBottomBtnActive]}
              onPress={() => setActivePanel((p) => (p === "files" ? null : "files"))}
              accessibilityRole="button"
              accessibilityLabel={t("toolbar.filesA11y")}
            >
              <Folder size={22} color={activePanel === "files" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
              <Text numberOfLines={1} style={[styles.portraitBottomBtnLabel, activePanel === "files" && styles.portraitBottomBtnLabelActive]}>{t("toolbar.files")}</Text>
            </TouchableOpacity>

            {/* Snel */}
            <TouchableOpacity
              style={[styles.portraitBottomBtn, activePanel === "quickActions" && styles.portraitBottomBtnActive]}
              onPress={() => setActivePanel((p) => (p === "quickActions" ? null : "quickActions"))}
              accessibilityRole="button"
              accessibilityLabel={t("toolbar.quickA11y")}
            >
              <Zap size={22} color={activePanel === "quickActions" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
              <Text numberOfLines={1} style={[styles.portraitBottomBtnLabel, activePanel === "quickActions" && styles.portraitBottomBtnLabelActive]}>{t("toolbar.quick")}</Text>
            </TouchableOpacity>

            {/* Toetsenbord */}
            <TouchableOpacity
              style={[styles.portraitBottomBtn, keyboardVisible && styles.portraitBottomBtnActive]}
              onPress={() => setKeyboardVisible((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t("toolbar.keyboardA11y")}
            >
              <Keyboard size={22} color={keyboardVisible ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
              <Text numberOfLines={1} style={[styles.portraitBottomBtnLabel, keyboardVisible && styles.portraitBottomBtnLabelActive]}>{t("portrait.keyboard")}</Text>
            </TouchableOpacity>

            {/* Chat */}
            <TouchableOpacity
              style={[styles.portraitBottomBtn, activePanel === "chat" && styles.portraitBottomBtnActive]}
              onPress={openChat}
              accessibilityRole="button"
              accessibilityLabel={t("toolbar.chat")}
            >
              <MessageCircle size={22} color={activePanel === "chat" ? "#fff" : colors.toolbarButton} strokeWidth={2.2} />
              {hasUnreadChat && <View style={styles.unreadDot} />}
              <Text numberOfLines={1} style={[styles.portraitBottomBtnLabel, activePanel === "chat" && styles.portraitBottomBtnLabelActive]}>{t("toolbar.chat")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Landscape: existing collapsed/expanded toolbar ─────────────── */}
        {isLandscape && (toolbarCollapsed ? (
          <TouchableOpacity
            style={[styles.expandBtn, { bottom: 8 + insets.bottom }]}
            onPress={() => setToolbarCollapsed(false)}
            accessibilityRole="button"
            accessibilityLabel={t("toolbar.expandA11y")}
          >
            <ChevronUp size={20} color={colors.muted} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : (
          <View style={[styles.solidToolbarWrap, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
            <View style={styles.sessionToolbar}>
              <ScrollView
                horizontal
                style={styles.toolbarActions}
                contentContainerStyle={styles.toolbarActionsContent}
                showsHorizontalScrollIndicator={false}
              >
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "programs" && styles.toolbarBtnActive]}
                  onPress={openProgramsPanel}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.windowsA11y")}
                >
                  {toolbarIcon(AppWindow, t("toolbar.windows"), activePanel === "programs")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  onPress={() => setKeyboardVisible((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.keyboardA11y")}
                >
                  {toolbarIcon(Keyboard, t("toolbar.keyboardShort"))}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "interactionHelp" && styles.toolbarBtnActive]}
                  onPress={() => setActivePanel((p) => (p === "interactionHelp" ? null : "interactionHelp"))}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.controlA11y")}
                >
                  {toolbarIcon(
                    interactionMode === "touch" ? Hand : MousePointer2,
                    interactionMode === "touch" ? t("toolbar.tap") : t("toolbar.mouse"),
                    activePanel === "interactionHelp"
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, annotateModeActive && styles.toolbarBtnActive]}
                  onPress={toggleAnnotateMode}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.drawA11y")}
                >
                  {toolbarIcon(Pencil, t("toolbar.draw"), annotateModeActive)}
                </TouchableOpacity>
                {annotateModeActive && (
                  <TouchableOpacity
                    style={styles.toolbarBtn}
                    onPress={() => {
                      clearAnnotationsLocally();
                      sessionRef.current?.sendSystemCommand({ kind: "annotation-clear" });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("toolbar.clearA11y")}
                  >
                    {toolbarIcon(Trash2, t("toolbar.clear"))}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.toolbarBtn, micActive && styles.toolbarBtnActive]}
                  onPress={() => toggleMicrophone()}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.micA11y")}
                >
                  {toolbarIcon(micActive ? Mic : MicOff, t("toolbar.mic"), micActive)}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "quickActions" && styles.toolbarBtnActive]}
                  onPress={() => setActivePanel((p) => (p === "quickActions" ? null : "quickActions"))}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.quickA11y")}
                >
                  {toolbarIcon(Zap, t("toolbar.quick"), activePanel === "quickActions")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "chat" && styles.toolbarBtnActive]}
                  onPress={openChat}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.chat")}
                >
                  {toolbarIcon(MessageCircle, t("toolbar.chat"), activePanel === "chat")}
                  {hasUnreadChat && <View style={styles.unreadDot} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "files" && styles.toolbarBtnActive]}
                  onPress={() => setActivePanel((p) => (p === "files" ? null : "files"))}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.filesA11y")}
                >
                  {toolbarIcon(Folder, t("toolbar.files"), activePanel === "files")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "aiBuddy" && styles.toolbarBtnActive]}
                  onPress={() => setActivePanel((p) => (p === "aiBuddy" ? null : "aiBuddy"))}
                  accessibilityRole="button"
                  accessibilityLabel={t("aiBuddy.title")}
                >
                  {toolbarIcon(Sparkles, t("aiBuddy.title"), activePanel === "aiBuddy")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, activePanel === "settings" && styles.toolbarBtnActive]}
                  onPress={() => setActivePanel((p) => (p === "settings" ? null : "settings"))}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.settingsA11y")}
                >
                  {toolbarIcon(Settings, t("toolbar.options"), activePanel === "settings")}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toolbarBtn, styles.dangerBtn]}
                  onPress={disconnectSession}
                  accessibilityRole="button"
                  accessibilityLabel={t("toolbar.disconnectA11y")}
                >
                  {toolbarIcon(Power, t("toolbar.stop"), false, true)}
                </TouchableOpacity>
              </ScrollView>
              <TouchableOpacity
                style={styles.collapseBtn}
                onPress={() => setToolbarCollapsed(true)}
                accessibilityRole="button"
                accessibilityLabel={t("toolbar.collapseA11y")}
              >
                <ChevronDown size={20} color={colors.muted} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <Modal visible={activePanel === "settings"} transparent animationType="fade" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>{t("session.settingsTitle")}</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.connectionLabel")}</Text>
                  <Text style={styles.settingsValueText}>
                    {formatId(sessionPeer)}
                    {statsText ? ` · ${statsText}` : ""}
                  </Text>
                </View>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.qualityLabel")}</Text>
                  <View style={styles.modeToggle}>
                    {(["auto", "high", "low"] as QualityLevel[]).map((level) => (
                      <TouchableOpacity
                        key={level}
                        style={[styles.modeToggleBtn, qualityLevel === level && styles.modeToggleBtnActive]}
                        onPress={() => setQualityLevel(level)}
                      >
                        <Text style={[styles.settingsQualityText, qualityLevel === level && styles.settingsQualityTextActive]}>
                          {level === "auto" ? t("session.qualityAuto") : level === "high" ? t("session.qualityHigh") : t("session.qualityLow")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.zoomSharpnessLabel")}</Text>
                  <View style={styles.modeToggle}>
                    {(["tiered", "always-max"] as const).map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.modeToggleBtn, renderQualityMode === mode && styles.modeToggleBtnActive]}
                        onPress={() => setRenderQualityMode(mode)}
                      >
                        <Text style={[styles.settingsQualityText, renderQualityMode === mode && styles.settingsQualityTextActive]}>
                          {mode === "tiered" ? t("session.renderBalanced") : t("session.renderAlwaysSharp")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Text style={styles.muted}>
                  {t("session.renderTierHint")}
                </Text>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.codecLabel")}</Text>
                  <View style={styles.modeToggle}>
                    {(["sharp", "fast"] as const).map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.modeToggleBtn, codecPreference === mode && styles.modeToggleBtnActive]}
                        onPress={() => setCodecPreference(mode)}
                      >
                        <Text style={[styles.settingsQualityText, codecPreference === mode && styles.settingsQualityTextActive]}>
                          {mode === "sharp" ? t("session.codecSharp") : t("session.codecFast")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Text style={styles.muted}>
                  {t("session.codecHint")}
                </Text>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.resolutionLabel")}</Text>
                  <View style={styles.modeToggle}>
                    {(["sharp", "fast"] as const).map((mode) => (
                      <TouchableOpacity
                        key={mode}
                        style={[styles.modeToggleBtn, resolutionPreference === mode && styles.modeToggleBtnActive]}
                        onPress={() => setResolutionPreference(mode)}
                      >
                        <Text style={[styles.settingsQualityText, resolutionPreference === mode && styles.settingsQualityTextActive]}>
                          {mode === "sharp" ? t("session.codecSharp") : t("session.codecFast")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <Text style={styles.muted}>
                  {t("session.resolutionHint")}
                </Text>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.themeLabel")}</Text>
                  {renderThemeToggle()}
                </View>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("lang.switch")}</Text>
                  {renderLangToggle()}
                </View>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.showCursorLabel")}</Text>
                  <Switch
                    value={showRemoteCursor}
                    onValueChange={setShowRemoteCursor}
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.settingsRow}>
                  <Text style={styles.settingsLabel}>{t("session.hideWallpaperLabel")}</Text>
                  <Switch
                    value={wallpaperHidden}
                    onValueChange={toggleHideWallpaper}
                    trackColor={{ false: colors.switchOff, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
                {monitors.length > 1 && (
                  <View style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>{t("session.screenLabel")}</Text>
                    <View style={styles.modeToggle}>
                      <TouchableOpacity
                        style={[styles.modeToggleBtn, !monitorSplitMode && styles.modeToggleBtnActive]}
                        onPress={() => { setMonitorSplitMode(false); setSelectedSplitMonitors([]); }}
                      >
                        <Text style={[styles.settingsQualityText, !monitorSplitMode && styles.settingsQualityTextActive]}>{t("session.oneScreen")}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.modeToggleBtn, monitorSplitMode && styles.modeToggleBtnActive]}
                        onPress={() => { setMonitorSplitMode(true); setSelectedSplitMonitors([]); }}
                      >
                        <Text style={[styles.settingsQualityText, monitorSplitMode && styles.settingsQualityTextActive]}>{t("session.twoScreens")}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {monitors.length > 1 && monitorSplitMode && (
                  <Text style={[styles.muted, styles.splitHint]}>
                    {selectedSplitMonitors.length === 0
                      ? t("session.chooseTwoScreensStart")
                      : selectedSplitMonitors.length === 1
                      ? t("session.chooseTwoScreensSecond", { label: selectedSplitMonitors[0].label })
                      : t("session.twoScreensSelected")}
                  </Text>
                )}
                {monitors.length > 1 && (
                  <View style={styles.settingsRow}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monitorScroll}>
                      <View style={styles.modeToggle}>
                        {monitors.map((m) => {
                          const isSelected = monitorSplitMode && selectedSplitMonitors.some((sm) => sm.id === m.id);
                          const idx = selectedSplitMonitors.findIndex((sm) => sm.id === m.id);
                          const active = monitorSplitMode ? isSelected : activeMonitorId === m.id;
                          return (
                            <TouchableOpacity
                              key={m.id}
                              style={[styles.modeToggleBtn, active && styles.modeToggleBtnActive]}
                              onPress={() => (monitorSplitMode ? toggleSplitMonitorSelection(m) : switchMonitor(m.id))}
                            >
                              <Text style={[styles.settingsQualityText, active && styles.settingsQualityTextActive]}>
                                {monitorSplitMode && isSelected ? `${idx + 1}. ${m.label}` : m.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </ScrollView>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setActivePanel(null)}>
                <Text style={styles.primaryBtnText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "interactionHelp"} transparent animationType="fade" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>{t("control.title")}</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modeToggle}>
                  <TouchableOpacity
                    style={[styles.modeToggleBtn, styles.interactionHelpToggleBtn, interactionMode === "touch" && styles.modeToggleBtnActive]}
                    onPress={() => setInteractionMode("touch")}
                  >
                    {modeIcon(Hand, t("control.tapMode"), interactionMode === "touch")}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modeToggleBtn, styles.interactionHelpToggleBtn, interactionMode === "mouse" && styles.modeToggleBtnActive]}
                    onPress={() => setInteractionMode("mouse")}
                  >
                    {modeIcon(MousePointer2, t("control.mouseMode"), interactionMode === "mouse")}
                  </TouchableOpacity>
                </View>
                <Text style={styles.interactionHelpIntro}>
                  {interactionMode === "mouse"
                    ? t("control.mouseIntro")
                    : t("control.touchIntro")}
                </Text>
                <View style={styles.interactionHelpGrid}>
                  {(interactionMode === "mouse" ? mouseModeGestures : touchModeGestures).map((g) => (
                    <View key={g.id} style={styles.interactionHelpItem}>
                      <View style={styles.interactionHelpIconWrap}>
                        <g.Icon size={22} color={colors.primary} strokeWidth={2} />
                      </View>
                      <Text style={styles.interactionHelpItemTitle}>{g.title}</Text>
                      <Text style={styles.interactionHelpItemDesc}>{g.desc}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setActivePanel(null)}>
                <Text style={styles.primaryBtnText}>{t("common.close")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "quickActions"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={[styles.chatCard, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>{t("quickActions.title")}</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel={t("common.close")}>
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <ScrollView>
                {(
                  [
                    { id: "copy", Icon: Copy, title: t("quickActions.copy"), subtitle: "Ctrl+C", onPress: () => sendShortcut(["ControlLeft", "KeyC"]), danger: false },
                    { id: "paste", Icon: ClipboardPaste, title: t("quickActions.paste"), subtitle: "Ctrl+V", onPress: () => sendShortcut(["ControlLeft", "KeyV"]), danger: false },
                    { id: "screenshot", Icon: Camera, title: t("quickActions.screenshot"), subtitle: "PrtScn", onPress: () => sendShortcut(["PrintScreen"]), danger: false },
                    { id: "switchWindow", Icon: AppWindow, title: t("quickActions.switchWindow"), subtitle: "Alt+Tab", onPress: () => sendShortcut(["AltLeft", "Tab"]), danger: false },
                    { id: "save", Icon: Save, title: t("common.save"), subtitle: "Ctrl+S", onPress: () => sendShortcut(["ControlLeft", "KeyS"]), danger: false },
                    { id: "lock", Icon: Lock, title: t("quickActions.lock"), subtitle: undefined, onPress: lockRemote, danger: false },
                    { id: "cad", Icon: Keyboard, title: "Ctrl+Alt+Del", subtitle: undefined, onPress: sendCtrlAltDel, danger: false },
                    {
                      id: "blockInput",
                      Icon: Ban,
                      title: inputBlocked ? t("quickActions.inputBlocked") : t("quickActions.blockInput"),
                      subtitle: undefined,
                      onPress: toggleBlockInput,
                      danger: inputBlocked,
                    },
                    { id: "restart", Icon: RotateCw, title: t("quickActions.restart"), subtitle: undefined, onPress: restartRemote, danger: true },
                  ] as const
                ).map((item) => (
                  <TouchableOpacity key={item.id} style={styles.quickActionRow} onPress={item.onPress}>
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
            <View style={[styles.chatCard, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>{t("toolbar.chat")}</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel={t("chat.closeA11y")}>
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <ScrollView
                ref={chatScrollRef}
                style={styles.chatMessagesList}
                onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
              >
                {chatMessages.length === 0 && <Text style={styles.muted}>{t("chat.empty")}</Text>}
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
                  placeholder={t("chat.placeholder")}
                  placeholderTextColor="#8b96b8"
                  onSubmitEditing={sendChatMessage}
                  returnKeyType="send"
                />
                <TouchableOpacity style={styles.chatSendBtn} onPress={sendChatMessage}>
                  <Text style={styles.primaryBtnText}>{t("common.send")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "files"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={[styles.chatCard, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>{t("files.title")}</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel={t("files.closeA11y")}>
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.primaryBtn} onPress={sendFilePress}>
                <Text style={styles.primaryBtnText}>{t("files.send")}</Text>
              </TouchableOpacity>
              <ScrollView style={styles.chatMessagesList}>
                {fileTransfers.length === 0 && <Text style={styles.fileEmptyText}>{t("files.empty")}</Text>}
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
                      <Text style={styles.fileRowStatus}>{f.done ? (f.direction === "receive" ? t("files.savedInDownloads") : t("files.sent")) : `${Math.round(pct * 100)}%`}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal visible={activePanel === "programs"} transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <View style={styles.chatBackdrop}>
            <View style={[styles.chatCard, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
              <View style={styles.chatHeader}>
                <Text style={styles.cardTitle}>{t("programs.title")}</Text>
                <TouchableOpacity style={styles.toolbarBtn} onPress={() => setActivePanel(null)} accessibilityRole="button" accessibilityLabel={t("programs.closeA11y")}>
                  {toolbarIcon(X)}
                </TouchableOpacity>
              </View>

              <View style={[styles.modeToggle, styles.splitModeToggle]}>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, !splitMode && styles.modeToggleBtnActive]}
                  onPress={() => { setSplitMode(false); setSelectedSplitWindows([]); }}
                >
                  <Text style={[styles.settingsQualityText, !splitMode && styles.settingsQualityTextActive]}>{t("programs.oneWindow")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, splitMode && styles.modeToggleBtnActive]}
                  onPress={() => { setSplitMode(true); setSelectedSplitWindows([]); }}
                >
                  <Text style={[styles.settingsQualityText, splitMode && styles.settingsQualityTextActive]}>{t("programs.twoWindowsSplit")}</Text>
                </TouchableOpacity>
              </View>

              {splitMode && (
                <Text style={[styles.muted, styles.splitHint]}>
                  {selectedSplitWindows.length === 0
                    ? t("programs.chooseTwoStart")
                    : selectedSplitWindows.length === 1
                    ? t("programs.chooseTwoSecond", { name: selectedSplitWindows[0].name })
                    : t("programs.twoSelected")}
                </Text>
              )}

              <ScrollView style={styles.chatMessagesList}>
                {windowList.length === 0 && <Text style={styles.fileEmptyText}>{t("programs.empty")}</Text>}
                {windowList.map((w) => {
                  const isSelected = selectedSplitWindows.some((sw) => sw.id === w.id);
                  const idx = selectedSplitWindows.findIndex((sw) => sw.id === w.id);
                  return (
                    <TouchableOpacity
                      key={w.id}
                      style={[styles.programRow, isSelected && styles.programRowSelected]}
                      onPress={() => (splitMode ? toggleSplitWindowSelection(w) : selectProgram(w))}
                    >
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
                      {splitMode && isSelected && (
                        <View style={styles.selectionBadge}>
                          <Text style={styles.selectionBadgeText}>{idx + 1}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
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
                  <Text style={styles.outlineBtnText}>{t("common.decline")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => answerConfirm("allow")}>
                  <Text style={styles.primaryBtnText}>{t("common.confirm")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle={theme === "dark" ? "light-content" : "dark-content"} />

      {/* ── Tab: Home ─────────────────────────────────────────────────── */}
      {activeTab === "home" && (
        <ScrollView contentContainerStyle={styles.scroll} style={styles.tabContent}>
          <Image source={logo2} style={styles.logo} resizeMode="contain" />

          {/* Verbinden bovenaan */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("home.cardTitle")}</Text>
            {savedDevices.length > 0 && (
              <>
                <Text style={styles.label}>{t("home.savedDevices")}</Text>
                {savedDevices.map((device) => (
                  <View key={device.id} style={styles.savedDeviceRow}>
                    <TouchableOpacity style={styles.savedDeviceMain} onPress={() => connectToSaved(device)}>
                      <Text style={styles.savedDeviceLabel}>{device.label}</Text>
                      <Text style={styles.savedDeviceId}>{formatId(device.id)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.savedDeviceIconBtn}
                      onPress={() => handleToggleFavorite(device.id)}
                      accessibilityLabel={device.favorite ? t("home.favoriteRemove") : t("home.favoriteAdd")}
                    >
                      <Star size={18} color={device.favorite ? colors.primary : colors.muted} fill={device.favorite ? colors.primary : "transparent"} strokeWidth={2.2} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.savedDeviceIconBtn}
                      onPress={() => handleRemoveSaved(device.id, device.label)}
                      accessibilityLabel={t("home.removeDeviceA11y")}
                    >
                      <Trash2 size={18} color={colors.muted} strokeWidth={2.2} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.divider} />
              </>
            )}
            <Text style={styles.label}>{t("home.partnerId")}</Text>
            <TextInput style={styles.input} value={targetId} onChangeText={setTargetId} keyboardType="number-pad" placeholder={t("home.partnerIdPlaceholder")} />
            <Text style={styles.label}>{t("home.password")}</Text>
            <TextInput style={styles.input} value={targetPassword} onChangeText={setTargetPassword} secureTextEntry placeholder={t("home.password")} />
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>{t("home.rememberDevice")}</Text>
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
                placeholder={t("home.rememberNamePlaceholder")}
                placeholderTextColor={colors.muted}
              />
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={onConnectPress}>
              <Text style={styles.primaryBtnText}>{t("common.connect")}</Text>
            </TouchableOpacity>
            {!!connectStatus && <Text style={styles.connectStatus}>{connectStatus}</Text>}
          </View>

          {/* Dit apparaat eronder */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("home.thisDeviceTitle")}</Text>
            <Text style={styles.label}>{t("home.myIdLabel")}</Text>
            <Text style={styles.mono}>{myId ? formatId(myId) : "—"}</Text>
            <Text style={[styles.statusText, serverStatus === "connected" ? styles.statusOk : styles.statusBad]}>
              {serverStatus === "connected" ? t("home.serverConnected") : serverStatus === "connecting" ? t("boot.connecting") : t("home.serverDisconnected")}
            </Text>
            <Text style={styles.label}>{t("home.sessionPasswordLabel")}</Text>
            <Text style={styles.mono}>{hostSessionPassword}</Text>
            <Text style={styles.muted}>{t("home.shareHint")}</Text>
          </View>
        </ScrollView>
      )}

      {/* ── Tab: Instellingen ─────────────────────────────────────────── */}
      {activeTab === "instellingen" && (
        <ScrollView contentContainerStyle={styles.scroll} style={styles.tabContent}>
          <Image source={logo2} style={styles.logo} resizeMode="contain" />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("settings.displayCardTitle")}</Text>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>{t("session.themeLabel")}</Text>
              {renderThemeToggle()}
            </View>
            <Text style={styles.muted}>{t("settings.themeHint")}</Text>
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>{t("lang.switch")}</Text>
              {renderLangToggle()}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("settings.remoteControlCardTitle")}</Text>
            <Text style={styles.muted}>
              {t("settings.remoteControlHint")}
            </Text>
            <Text style={[styles.statusText, accessibilityEnabled ? styles.statusOk : styles.statusBad]}>
              {accessibilityEnabled ? t("settings.enabled") : t("settings.remoteControlDisabled")}
            </Text>
            {!accessibilityEnabled && (
              <TouchableOpacity style={styles.primaryBtn} onPress={openAccessibilitySettings}>
                <Text style={styles.primaryBtnText}>{t("settings.openSettings")}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("settings.virtualKeyboardCardTitle")}</Text>
            <Text style={styles.muted}>
              {t("settings.virtualKeyboardHint")}
            </Text>
            <Text style={[styles.statusText, virtualKeyboardEnabled ? styles.statusOk : styles.statusBad]}>
              {virtualKeyboardEnabled ? t("settings.enabled") : t("settings.virtualKeyboardDisabled")}
            </Text>
            {!virtualKeyboardEnabled && (
              <TouchableOpacity style={styles.primaryBtn} onPress={openKeyboardSettings}>
                <Text style={styles.primaryBtnText}>{t("settings.openSettings")}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("license.cardTitle")}</Text>
            <Text style={styles.muted}>
              {t("license.hint")}
            </Text>
            <Text style={styles.label}>{t("license.emailLabel")}</Text>
            <TextInput
              style={styles.input}
              value={licenseEmailInput}
              onChangeText={setLicenseEmailInput}
              placeholder={t("license.emailPlaceholder")}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.label}>{t("license.keyLabel")}</Text>
            <TextInput
              style={styles.input}
              value={licenseKeyInput}
              onChangeText={setLicenseKeyInput}
              placeholder={t("license.keyPlaceholder")}
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleVerifyLicense} disabled={licenseVerifying}>
              <Text style={styles.primaryBtnText}>{licenseVerifying ? t("license.checking") : t("license.verifyBtn")}</Text>
            </TouchableOpacity>
            {licenseStatusInfo ? (
              <Text style={[styles.statusText, licenseStatusInfo.valid ? styles.statusOk : styles.statusBad]}>
                {licenseStatusInfo.valid
                  ? t("license.statusActive", { plan: licenseStatusInfo.plan || "Free" })
                  : t("license.statusInvalid", { reason: licenseStatusInfo.reason || t("license.invalidReason") })}
              </Text>
            ) : (
              <Text style={styles.muted}>{t("license.statusNotChecked")}</Text>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Tab: Meer ─────────────────────────────────────────────────── */}
      {activeTab === "meer" && (
        <ScrollView contentContainerStyle={styles.scroll} style={styles.tabContent}>
          <Image source={logo2} style={styles.logo} resizeMode="contain" />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("history.cardTitle")}</Text>
            {sessionHistory.length === 0 ? (
              <Text style={styles.muted}>{t("history.empty")}</Text>
            ) : (
              <>
                <TouchableOpacity onPress={() => setSessionHistoryExpanded((v) => !v)}>
                  <Text style={styles.label}>
                    {t("history.summary", {
                      count: sessionHistory.length,
                      started: new Date(sessionHistory[0].startedAt).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
                      peerId: formatId(sessionHistory[0].peerId),
                      toggle: sessionHistoryExpanded ? t("history.hide") : t("history.show"),
                    })}
                  </Text>
                </TouchableOpacity>
                {sessionHistoryExpanded && (
                  <>
                    {sessionHistory.map((entry) => (
                      <View key={entry.id} style={styles.savedDeviceRow}>
                        <View style={styles.savedDeviceMain}>
                          <Text style={styles.savedDeviceLabel}>{formatId(entry.peerId)}</Text>
                          <Text style={styles.savedDeviceId}>
                            {new Date(entry.startedAt).toLocaleString(lang === "nl" ? "nl-NL" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {" · "}
                            {formatDuration(entry.durationSec)}
                            {entry.filesTransferred > 0 ? t("history.filesTransferredSuffix", { count: entry.filesTransferred }) : ""}
                          </Text>
                        </View>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={styles.outlineBtn}
                      onPress={() => {
                        Alert.alert(t("history.clearConfirmTitle"), t("history.clearConfirmMsg"), [
                          { text: t("common.cancel"), style: "cancel" },
                          {
                            text: t("common.clear"),
                            style: "destructive",
                            onPress: () =>
                              clearSessionHistory().then((h) => {
                                setSessionHistoryState(h);
                                setSessionHistoryExpanded(false);
                                showToast(t("history.clearedToast"));
                              }),
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.outlineBtnText}>{t("history.clearBtn")}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("notifications.cardTitle")}</Text>
            <Text style={styles.muted}>
              {t("notifications.hint")}
            </Text>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => openConfirmNotificationSettings()}>
              <Text style={styles.outlineBtnText}>{t("notifications.adjustSound")}</Text>
            </TouchableOpacity>
            {notifications.length === 0 && <Text style={styles.muted}>{t("notifications.empty")}</Text>}
            {notifications.map((n) => (
              <View key={n.id} style={styles.notifyRow}>
                <Text style={styles.notifyTitle}>{n.title}</Text>
                <Text style={styles.notifySource}>{n.source}</Text>
                <Text style={styles.notifyMessage}>{n.message}</Text>
                {!!n.command && <Text style={styles.notifyCommand}>{n.command}</Text>}
                {n.status && (
                  <Text style={n.status === "allow" ? styles.statusOk : styles.statusBad}>
                    {n.status === "allow" ? t("notifications.confirmed") : t("notifications.denied")}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t("aiBuddy.title")}</Text>
            <Text style={styles.muted}>
              {t("aiBuddy.cardDesc")}
            </Text>
            <Text style={styles.label}>{t("aiBuddy.keyLabel")}</Text>
            <TextInput
              style={styles.input}
              value={openaiKeyInput}
              onChangeText={setOpenaiKeyInput}
              placeholder={t("aiBuddy.keyPlaceholder")}
              placeholderTextColor="#8b96b8"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={saveOpenAiKey}>
              <Text style={styles.primaryBtnText}>{t("common.save")}</Text>
            </TouchableOpacity>
            <Text style={styles.muted}>{openaiKeyConfigured ? t("aiBuddy.keySet") : t("aiBuddy.keyNotSet")}</Text>
          </View>
        </ScrollView>
      )}



      {/* ── Bottom tab bar ────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabBarBtn} onPress={() => setActiveTab("home")}>
          <Home size={22} color={activeTab === "home" ? colors.primary : colors.muted} strokeWidth={activeTab === "home" ? 2.5 : 2} />
          <Text style={[styles.tabBarLabel, activeTab === "home" && styles.tabBarLabelActive]}>{t("tabBar.home")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBarBtn} onPress={() => setActiveTab("instellingen")}>
          <Settings size={22} color={activeTab === "instellingen" ? colors.primary : colors.muted} strokeWidth={activeTab === "instellingen" ? 2.5 : 2} />
          <Text style={[styles.tabBarLabel, activeTab === "instellingen" && styles.tabBarLabelActive]}>{t("tabBar.settings")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBarBtn} onPress={() => setActiveTab("meer")}>
          <MoreHorizontal size={22} color={activeTab === "meer" ? colors.primary : colors.muted} strokeWidth={activeTab === "meer" ? 2.5 : 2} />
          <Text style={[styles.tabBarLabel, activeTab === "meer" && styles.tabBarLabelActive]}>{t("tabBar.more")}</Text>
        </TouchableOpacity>
      </View>


      <Modal visible={!!activeConfirm} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{activeConfirm?.title}</Text>
            <Text style={styles.notifySource}>{activeConfirm?.source}</Text>
            <Text style={styles.notifyMessage}>{activeConfirm?.message}</Text>
            {!!activeConfirm?.command && <Text style={styles.notifyCommand}>{activeConfirm.command}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => answerConfirm("deny")}>
                <Text style={styles.outlineBtnText}>{t("common.decline")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => answerConfirm("allow")}>
                <Text style={styles.primaryBtnText}>{t("common.confirm")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!pendingIncoming} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{t("incoming.title")}</Text>
            <Text style={styles.notifyMessage}>{t("incoming.message", { id: pendingIncoming ? formatId(pendingIncoming.fromId) : "" })}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => respondToIncoming(false)}>
                <Text style={styles.outlineBtnText}>{t("common.decline")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => respondToIncoming(true)}>
                <Text style={styles.primaryBtnText}>{t("incoming.allow")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={!!totpRequired} transparent animationType="fade" onRequestClose={() => setTotpRequired(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>{t("totp.title")}</Text>
            <Text style={styles.notifyMessage}>
              {totpRequired === "bad-totp" ? t("totp.badCode") : t("totp.required")}
            </Text>
            <TextInput
              style={styles.input}
              value={totpCode}
              onChangeText={setTotpCode}
              placeholder={t("totp.placeholder")}
              placeholderTextColor="#8b96b8"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>{t("totp.remember")}</Text>
              <Switch
                value={trustThisDevice}
                onValueChange={setTrustThisDevice}
                trackColor={{ false: colors.switchOff, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => setTotpRequired(null)}>
                <Text style={styles.outlineBtnText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={submitTotpCode}>
                <Text style={styles.primaryBtnText}>{t("common.confirm")}</Text>
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
    root: { flex: 1, backgroundColor: colors.bg, flexDirection: "column" },
    scroll: { padding: 20, paddingBottom: 16 },
    tabContent: { flex: 1 },
    logo: { height: 44, width: 200, marginBottom: 16, alignSelf: "center" },
    // ── Bottom tab bar ───────────────────────────────────────────────────
    tabBar: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingBottom: 4,
      zIndex: 100,
    },
    tabBarBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
    },
    tabBarIcon: {
      fontSize: 20,
      color: colors.muted,
      marginBottom: 2,
    },
    tabBarIconActive: {
      color: colors.primary,
    },
    tabBarLabel: {
      fontSize: 10,
      fontWeight: "600",
      color: colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    tabBarLabelActive: {
      color: colors.primary,
    },
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
    modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: 20, maxHeight: "100%" },
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
    programRowSelected: { backgroundColor: "rgba(52, 120, 246, 0.2)", borderColor: colors.primary, borderWidth: 1.5 },
    selectionBadge: { backgroundColor: colors.primary, borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" },
    selectionBadgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
    splitModeToggle: { marginBottom: 10 },
    splitHint: { marginBottom: 8, fontSize: 12 },
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
    sessionColumn: { flex: 1, flexDirection: "column" },
    sessionContainer: { flex: 1, backgroundColor: "#000", flexDirection: "column" },
    sessionContainerLandscape: { flexDirection: "row" },
    videoWrapPortraitWithAi: { flex: 0.42 },
    aiBuddyPortraitPanel: {
      flex: 0.58,
      backgroundColor: colors.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingTop: 12,
      paddingHorizontal: 12,
    },
    aiBuddyLandscapePanel: {
      width: 360,
      maxWidth: "45%",
      backgroundColor: colors.card,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      paddingTop: 12,
    },
    aiBuddyCardInner: { flex: 1, paddingHorizontal: 12 },
    // A real flex sibling of sessionContainer (see its JSX placement) —
    // deliberately *not* a floating overlay: video must never render behind
    // it, so it needs to actually take its own row and push the video down,
    // not just visually sit on top while the video still occupies that space.
    portraitTopBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.overlayBg,
      borderBottomWidth: 1,
      borderBottomColor: "rgba(255,255,255,0.08)",
    },
    portraitTopBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 6,
    },
    portraitTopBtnActive: {
      backgroundColor: colors.primary,
    },
    portraitTopBtnDanger: {
      backgroundColor: "#c0392b",
    },
    portraitTopBtnLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.toolbarButton,
    },
    portraitTopBtnLabelActive: {
      color: "#fff",
    },
    portraitTopSpacer: { flex: 1 },

    // Portrait mode: fixed bottom bar during session
    // Same reasoning as portraitTopBar above — a real flex sibling, not an
    // overlay, so it actually reserves its own space instead of floating on
    // top of the video.
    portraitBottomBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-around",
      backgroundColor: colors.overlayBg,
      borderTopWidth: 1,
      borderTopColor: "rgba(255,255,255,0.08)",
      paddingTop: 4,
    },
    portraitBottomBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 3,
      gap: 2,
      borderRadius: 8,
    },
    portraitBottomBtnActive: {
      backgroundColor: colors.primary,
    },
    portraitBottomBtnLabel: {
      fontSize: 8,
      fontWeight: "700",
      color: colors.toolbarButton,
      textTransform: "uppercase",
      letterSpacing: 0,
    },
    portraitBottomBtnLabelActive: {
      color: "#fff",
    },

    solidToolbarWrap: { backgroundColor: colors.overlayBg },
    sessionToolbar: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 10 },
    toolbarActions: { flex: 1 },
    toolbarActionsContent: { alignItems: "center", paddingLeft: 8 },
    // Flat by default — no background pill, just a colored icon+label — a
    // filled pill only appears for whichever panel is actually open
    // (toolbarBtnActive) so there's still some indication of open state.
    toolbarBtn: { borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, marginLeft: 8, minWidth: 48, alignItems: "center" },
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
    qualityBadge: {
      position: "absolute",
      top: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.toastBg,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 6,
      zIndex: 20,
    },
    qualityBadgeText: { color: "#fff", fontSize: 11, fontWeight: "600", marginLeft: 5 },
    // Top-left, deliberately the opposite corner from qualityBadge
    // (top-right) so the two can never overlap without needing nudge logic.
    appModeCloseBtn: {
      position: "absolute",
      top: 16,
      left: 16,
      zIndex: 20,
      backgroundColor: colors.danger,
      borderRadius: 14,
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
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
    cursorDot: { position: "absolute", width: 24, height: 24 },
    annotationOverlay: { position: "absolute" },
    hiddenInput: { position: "absolute", bottom: 0, left: 0, right: 0, height: 40, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 10 },
  });
}
