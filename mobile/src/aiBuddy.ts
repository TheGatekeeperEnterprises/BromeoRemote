import { NativeModules, findNodeHandle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// "AI Buddy" — local-only (never touches the signaling server), this device
// asks its own configured OpenAI account for help while looking at a remote
// session, optionally attaching a screenshot of the current remote video
// frame.
//
// Key storage note: this uses AsyncStorage (same as the app's other
// settings), which is sandboxed per-app but NOT hardware-encrypted —a
// lower security tier than the desktop client's approach (Electron
// safeStorage / OS keychain). A billable API key arguably deserves that
// stronger protection too; deferred for now rather than adding a second new
// native dependency (react-native-keychain) in the same pass as the
// PixelCopy screenshot module below.
const OPENAI_KEY_STORAGE_KEY = "bromeoremote_openai_api_key";

const { AiBuddyScreenshotModule } = NativeModules;

export interface AiBuddyMessage {
  role: "user" | "assistant";
  text: string;
  imageBase64?: string; // data URL, e.g. "data:image/jpeg;base64,..."
}

export interface AiBuddyResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

export async function getOpenAiApiKey(): Promise<string | null> {
  return AsyncStorage.getItem(OPENAI_KEY_STORAGE_KEY);
}

export async function setOpenAiApiKey(key: string | null): Promise<void> {
  if (key) await AsyncStorage.setItem(OPENAI_KEY_STORAGE_KEY, key);
  else await AsyncStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
}

// Captures the current frame from an RTCView by native tag — see
// AiBuddyScreenshotModule.kt for why this needs PixelCopy rather than a
// JS-level view-snapshot library (react-native-view-shot produces a black
// image for SurfaceView-backed views like RTCView, a confirmed upstream
// limitation, not something fixable here).
export async function captureRemoteVideoFrame(rtcViewRef: React.RefObject<unknown>): Promise<string | null> {
  const viewTag = findNodeHandle(rtcViewRef.current as any);
  if (viewTag == null) return null;
  try {
    return await AiBuddyScreenshotModule.captureView(viewTag);
  } catch {
    return null;
  }
}

const MODEL = "gpt-4o-mini";

export async function askAiBuddy(history: AiBuddyMessage[]): Promise<AiBuddyResult> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) return { ok: false, error: "Geen OpenAI API-sleutel ingesteld." };

  const messages = [
    {
      role: "system",
      content:
        "Je bent 'AI Buddy' binnen BromeoRemote, een hulp-assistent die de gebruiker stap voor stap helpt " +
        "een probleem op te lossen op een pc/telefoon die zij op afstand bedienen via een schermdeel-sessie. " +
        "Als er een screenshot is bijgevoegd, is dat een momentopname van het scherm van het apparaat op afstand — " +
        "gebruik het om concreet en specifiek advies te geven (welke knop, welk menu, welke foutmelding je ziet). " +
        "Antwoord kort en praktisch, in stappen.",
    },
    ...history.map((m) => ({
      role: m.role,
      content: m.imageBase64
        ? [
            { type: "text", text: m.text },
            { type: "image_url", image_url: { url: m.imageBase64 } },
          ]
        : m.text,
    })),
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 1000 }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body;
      try {
        detail = JSON.parse(body)?.error?.message ?? body;
      } catch {
        // keep raw body
      }
      return { ok: false, error: `OpenAI-fout (${res.status}): ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) return { ok: false, error: "Geen antwoord ontvangen van OpenAI." };
    return { ok: true, reply };
  } catch (err) {
    return { ok: false, error: `Kon OpenAI niet bereiken: ${(err as Error).message}` };
  }
}
