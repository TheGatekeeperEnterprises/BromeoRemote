# BromeoRemote ⇄ Google Antigravity — meldingen & bevestigingen op afstand

Jij werkt vaak op afstand aan projecten. Wanneer **Google Antigravity** (Google's agentic dev-platform — IDE + CLI, vergelijkbaar met hoe deze assistent werkt) ergens een bevestiging voor nodig heeft ("mag ik dit commando uitvoeren?"), wil je dat direct weten en kunnen afhandelen, ook als je niet achter die pc zit.

BromeoRemote heeft daarom een **generieke notificatie-brug** ingebouwd. Dit is geen Antigravity-specifieke hack — het is een kleine lokale API die door *elk* stukje software op je pc aangeroepen kan worden, met Antigravity als eerste, concrete toepassing.

## Hoe het werkt

```
Antigravity hook (op jouw pc)
        │  POST http://localhost:8973/confirm   ← blokkeert, wacht op antwoord
        ▼
BromeoRemote (lokale bridge, in de app zelf)
        │  toont melding lokaal + stuurt 'm door via de signaling server
        ▼
Jouw andere apparaat (telefoon/laptop, BromeoRemote open)
        │  jij tikt "Bevestigen" of "Weigeren"
        ▼
Antwoord loopt terug via de signaling server naar de oorspronkelijke pc
        │
        ▼
De openstaande HTTP-aanvraag rondt af met {"decision":"allow"|"deny"}
        → de hook geeft dit door aan Antigravity
```

Dit is **end-to-end getest** in deze build: een melding en een blokkerend bevestigingsverzoek zijn beide met succes van het ene apparaat naar het andere doorgestuurd, inclusief het automatisch sluiten van het venstertje op het originele apparaat zodra jij elders antwoordt, én de veilige timeout-fallback (standaard "weigeren" als niemand binnen de ingestelde tijd reageert).

## 1. BromeoRemote instellen

In de app, kaart **"Agent-meldingen"**:
1. Vul bij **"Meldingen doorsturen naar"** het BromeoRemote-ID in van het apparaat waar je vaak op afstand bij bent (je telefoon zodra er een app is, of nu al: een laptop).
2. Klaar — de pc waarop Antigravity draait heeft verder niets extra's nodig, de lokale brug luistert altijd op `http://localhost:8973`.

## 2. Antigravity koppelen (hook)

> **Update (2026-07):** een eerdere versie van dit document verwees naar een `ask_permission`-event — dat bestaat niet in Antigravity's daadwerkelijke hooks-API (geverifieerd tegen `antigravity.google/docs/hooks`). Die configuratie zou dus nooit hebben gewerkt. Onderstaande versie gebruikt het echte, huidige contract: het `PreToolUse`-event met een `decision`-veld in de hook-output. Antigravity's hooks-systeem is nog relatief nieuw — controleer bij twijfel altijd de actuele documentatie.

Antigravity ondersteunt hooks op vaste lifecycle-checkpoints, waaronder `PreToolUse` (vlak voordat een tool/commando wordt uitgevoerd). Voeg in jouw `hooks.json` toe — workspace-niveau: `.agents/hooks.json`, of globaal (geldt voor al je projecten): `~/.gemini/config/hooks.json` (op Windows: `C:\Users\<jij>\.gemini\config\hooks.json`):

```json
{
  "hooks": {
    "bromeoremote-confirm": {
      "enabled": true,
      "PreToolUse": [
        {
          "matcher": "run_command",
          "hooks": [
            {
              "type": "command",
              "command": "node ./scripts/bromeoremote-hook.js",
              "timeout": 130
            }
          ]
        }
      ]
    }
  }
}
```

`matcher: "run_command"` betekent: alleen bevestiging vragen voordat Antigravity een shell-commando uitvoert (het risicovolste geval) — niet bij elke los bestand lezen. Pas de matcher aan als je ook bij andere tools bevestiging wilt. `timeout: 130` (seconden) moet ruimer zijn dan de `timeoutMs` die de hook naar BromeoRemote stuurt (120000ms = 120s).

Het script staat direct klaar in de repository op `scripts/bromeoremote-hook.js`:

```js
// scripts/bromeoremote-hook.js — vraagt BromeoRemote om bevestiging en geeft het
// antwoord door aan Antigravity.
// Input (stdin JSON):  { toolCall: { name, args }, stepIdx, conversationId,
//   workspacePaths, transcriptPath, artifactDirectoryPath }
// Output (stdout JSON): { decision: "allow"|"deny"|"ask"|"force_ask", reason? }
const fs = require("fs");
const http = require("http");

function postConfirm(bodyData) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(bodyData);
    const req = http.request({
      hostname: "127.0.0.1",
      port: 8973,
      path: "/confirm",
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(dataString)
      },
      timeout: 125000
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error("Ongeldige JSON-reactie van BromeoRemote bridge")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("BromeoRemote bridge time-out")); });
    req.write(dataString);
    req.end();
  });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch (err) {
    console.log(JSON.stringify({ decision: "ask", reason: `Hook input parse error: ${err.message}` }));
    return;
  }

  const toolName = payload.toolCall?.name ?? "onbekende actie";
  const args = payload.toolCall?.args ?? {};
  const command = args.CommandLine ?? args.command ?? args.TargetFile ?? (typeof args === "object" ? JSON.stringify(args) : String(args));
  const cwd = args.Cwd ?? (payload.workspacePaths ?? [])[0] ?? process.cwd();
  const riskLevel = (toolName === "run_command" || toolName === "unsandboxed") ? "high" : "medium";

  try {
    const data = await postConfirm({
      source: "Google Antigravity",
      title: `Bevestiging voor ${toolName}`,
      message: `Antigravity vraagt toestemming voor actie '${toolName}'`,
      command, cwd, riskLevel, timeoutMs: 120000
    });
    const decision = data && data.decision === "allow" ? "allow" : "deny";
    console.log(JSON.stringify({ decision }));
  } catch (err) {
    console.log(JSON.stringify({ decision: "ask", reason: `BromeoRemote-brug onbereikbaar: ${err.message}` }));
  }
}

main();
```

Zodra Antigravity nu een `PreToolUse`-checkpoint voor `run_command` raakt: jij krijgt een melding (lokaal én op je doorstuur-apparaat), en Antigravity wacht tot jij "Bevestigen" of "Weigeren" tikt — vanaf de bank, de trein, waar dan ook.

## 3. De API zelf (voor eigen scripts, niet alleen Antigravity)

Alleen bereikbaar vanaf hetzelfde apparaat (`127.0.0.1`), geen authenticatie nodig — het is bedoeld voor lokale tools die als jijzelf draaien.

**`POST /notify`** — losse melding, geen antwoord verwacht:
```json
{ "source": "Build server", "title": "Build gefaald", "message": "3 tests rood op branch feature/x" }
```

**`POST /confirm`** — blokkeert tot jij antwoordt (of timeout verstrijkt):
```json
{
  "source": "Mijn script",
  "title": "Bevestig",
  "message": "Doorgaan met deployen naar productie?",
  "command": "kubectl apply -f deploy/prod.yaml",
  "cwd": "/home/user/project",
  "riskLevel": "high",
  "timeoutMs": 60000
}
```
Antwoord: `{ "decision": "allow" | "deny" }` — bij timeout altijd `"deny"` (veilige standaard).

`command`, `cwd` en `riskLevel` zijn allemaal optioneel — vul ze in als je ze hebt, en BromeoRemote toont het commando in een apart codeblok en een gekleurde risico-badge (groen/oranje/rood) in zowel de melding als de meldingengeschiedenis. Laat je ze weg, dan valt alles terug op gewone tekst in `message`.

## 4. Andere tools koppelen (niet alleen Antigravity)

De API is generiek — dit is een reëel onderscheid t.o.v. TeamViewer/AnyDesk, die dit soort koppeling helemaal niet aanbieden.

**Claude Code hooks** (`.claude/settings.json`, `PreToolUse`-hook):
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "node ./bromeoremote-hook.js" }]
      }
    ]
  }
}
```
Hetzelfde `bromeoremote-hook.js`-script als hierboven werkt, mits je het aan het exacte Claude Code hook-input/outputformaat aanpast (zie de Claude Code hooks-documentatie voor de precieze JSON-vorm die op stdin binnenkomt en die op stdout verwacht wordt).

**Losse `curl`-aanroep vanuit elk bash-script** (bv. voor een risicovolle stap in een deploy-script):
```bash
RESPONSE=$(curl -s -X POST http://localhost:8973/confirm \
  -H "Content-Type: application/json" \
  -d '{"source":"deploy.sh","title":"Productie-deploy","message":"Doorgaan?","command":"./deploy.sh --env=prod","riskLevel":"high","timeoutMs":120000}')
DECISION=$(echo "$RESPONSE" | grep -o '"decision":"[a-z]*"' | cut -d'"' -f4)
if [ "$DECISION" != "allow" ]; then echo "Geannuleerd."; exit 1; fi
```

**GitHub Actions bij een falende CI-run** — losse melding, geen antwoord nodig, dus gewoon `/notify` vanuit een self-hosted runner op je eigen netwerk (GitHub's cloud-runners kunnen je `localhost` natuurlijk niet bereiken):
```bash
curl -X POST http://localhost:8973/notify \
  -H "Content-Type: application/json" \
  -d '{"source":"GitHub Actions","title":"Build gefaald","message":"3 tests rood op branch '"$BRANCH"'"}'
```

## Belangrijke kanttekening

Behandel dit net zo serieus als de rest van je BromeoRemote-verbinding: gebruik in productie `wss://` voor de signaling server (zie `docs/DEPLOY.md`), zodat de inhoud van meldingen (die commando's/context kunnen bevatten) niet onversleuteld over het net gaat. De lokale bridge zelf verlaat nooit je eigen pc.

---

## Suggesties om dit nog verder uit te bouwen

1. **Echte push-notificaties (FCM/APNs) voor de toekomstige telefoon-app.** Een WebSocket-verbinding op je telefoon wordt door iOS/Android na verloop van tijd op de achtergrond afgesloten — voor betrouwbare meldingen *ook als de app dicht is*, heb je uiteindelijk echte mobiele push nodig. De signaling-server-relay die nu gebouwd is werkt al perfect zodra de telefoon-app open/actief is; FCM is de aanvulling voor de rest.
2. ~~Opgeslagen/vertrouwde apparaten met bewaarde koppeling.~~ **Gebouwd**: vink "Dit apparaat onthouden" aan bij het verbinden, en de knop "Bekijk live" in een bevestigingsmodal verbindt daarna in één tik — de wachtwoord-hash ligt versleuteld (Electron `safeStorage`, OS-keychain/DPAPI) lokaal opgeslagen. Werkt het betrouwbaarst in combinatie met "Onbeheerde toegang" (vast wachtwoord) op het doelapparaat, omdat een roterend sessiewachtwoord na een herstart niet meer matcht met de bewaarde hash.
3. ~~Rijkere actieknoppen per melding-type.~~ **Gebouwd**: `command`, `cwd` en `riskLevel` als optionele gestructureerde velden (zie boven) — getoond als codeblok + gekleurde risico-badge, zowel in de melding als de geschiedenis.
4. ~~Voorbeeld-scripts voor andere agents/tools.~~ **Gebouwd**: zie sectie "Andere tools koppelen" hierboven (Claude Code hooks, generieke `curl`, GitHub Actions).
5. **Geluid/kritieke meldingsstijl** voor `confirm`-verzoeken zodat ze opvallen tussen gewone `notify`-meldingen (nu al urgency:"critical" op het lokale OS-notificatie-niveau, maar dit kan verder met bv. een ander geluid of herhaalde melding als je niet binnen X seconden reageert).
6. **Audit-log van bevestigingen** (wie heeft wat wanneer goedgekeurd) — nuttig als je dit ooit met een team deelt, of gewoon als geheugensteun achteraf.
