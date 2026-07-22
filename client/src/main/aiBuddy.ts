import { store } from "./store";
import type { AiBuddyMessage, AiBuddyResult } from "../shared/protocol";

// "AI Buddy" — lets the user ask their own OpenAI account (their key, their
// bill) for help while looking at a remote session, optionally attaching a
// screenshot of the current remote video frame. Kept entirely in the main
// process (never exposed to the renderer) so the API key never has to cross
// into less-trusted context, and so the actual HTTPS call runs under
// Node's fetch (no CORS considerations) rather than the renderer's.

export type { AiBuddyMessage, AiBuddyResult };

const MODEL = "gpt-4o-mini";

export async function askAiBuddy(history: AiBuddyMessage[]): Promise<AiBuddyResult> {
  const apiKey = store.getOpenAiApiKey();
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
