# Meldingen/bevestigingen (Antigravity ⇄ BromeoRemote ⇄ telefoon)

## Status: FULLY VERIFIED END-TO-END (bridge-pipeline + live Antigravity hook round-trip).

Dit document is het vervolg/verificatielog op `docs/ANTIGRAVITY.md` (hoe de
koppeling werkt en hoe je 'm instelt) en `docs/MOBILE.md` §5 (hoe je FCM-push
serverside instelt). Lees die twee eerst als je de architectuur niet kent —
dit document gaat over **wat er mis was, wat er is gefixt, en hoe het geverifieerd is**, geschreven zodat een andere AI (of mens) dit koud kan oppakken zonder alles opnieuw te hoeven uitzoeken.

## 1. Het gerapporteerde probleem

Gebruiker: "waarom zie ik momenteel nog steeds geen meldingen binnenkomen op
de mobiele app zodra er hier een bevestiging moet worden gedaan in
antigravity ide op pc."

## 2. De architectuur (kort — zie ANTIGRAVITY.md voor het volledige plaatje)

```
Antigravity (PreToolUse hook, machine-lokaal, NIET in deze repo)
  → node bromeoremote-hook.js
  → POST http://localhost:8973/confirm   (client/src/main/bridge.ts, blokkeert)
  → desktop app (client/src/main/main.ts: handleBridgeNotification)
  → als notifyForwardId gezet is: signaling.send({type:"notify", ...})
    (client/src/renderer/app.ts)
  → signaling server (server/src/index.ts, case "notify"): stuurt ALTIJD
    beide kanalen tegelijk — direct via WebSocket (als target online is) ÉN
    via FCM-push (als er een geregistreerd token is), nooit maar één van de
    twee, want een telefoon kan er zomaar "online" uitzien terwijl de
    WebSocket eigenlijk al stervende is (achtergrond-throttling).
  → telefoon: mobile/src/App.tsx case "notify" (WebSocket-pad) of
    mobile/src/notifications.ts displayLocalNotification (FCM-pad, via
    notifee — dit is wat een confirm-melding volledig scherm laat tonen,
    zelfs boven het vergrendelscherm)
  → gebruiker tikt Bevestigen/Weigeren
  → signaling.send({type:"notify-response", ...}) terug naar de
    oorspronkelijke pc
  → client/src/renderer/app.ts: window.bromeo.sendBridgeDecision(...)
  → client/src/main/main.ts IPC-handler → bridge.ts resolvePending(id, decision)
  → de oorspronkelijk blokkerende HTTP-call van de hook rondt af
  → bromeoremote-hook.js geeft { decision } door aan Antigravity
```

## 3. Wat er daadwerkelijk mis was

Elke schakel hierboven is los gecontroleerd. Twee echte gaten gevonden,
allebei aan de **serverside push**-kant (de WebSocket-only route werkte in
theorie altijd al, mits de telefoon-app toevallig open/verbonden was op het
moment zelf):

1. **`FIREBASE_SERVICE_ACCOUNT_JSON`/`_PATH` stond niet op de daadwerkelijk
   draaiende Coolify-server.** Er lag wel een gedownload
   `firebase-service-account.json`-sleutelbestand, maar alleen lokaal in
   `%APPDATA%\BromeoRemote\` op het bureaublad-apparaat — nooit als
   omgevingsvariabele op de server zelf gezet. Zonder die variabele stopt
   `server/src/push.ts` stilletjes (één keer geloggd op de server's eigen
   console, onzichtbaar voor de gebruiker) — meldingen kwamen dus alléén aan
   als de telefoon-app toevallig al open/verbonden was.
2. **Push-tokens stonden alleen in-memory op de server**
   (`server/src/pushTokens.ts`, `new Map()`) — expliciet zo ontworpen
   ("stateless server"), maar dat betekent: elke serverherstart wist alle
   geregistreerde tokens tot de telefoon de app opnieuw opent.

## 4. Wat er is gefixt (code + config)

- **`server/src/push.ts`**: accepteert nu ook `FIREBASE_SERVICE_ACCOUNT_JSON`
  (de sleutel-inhoud zelf, of base64 daarvan) naast de bestaande
  `FIREBASE_SERVICE_ACCOUNT_PATH` — geen bestand/volume nodig, gewoon een
  env var in Coolify's UI plakken. `_JSON` wordt eerst gecheckt.
- **`server/src/pushTokens.ts`**: tokens worden nu weggeschreven naar
  `PUSH_TOKENS_PATH` (standaard `./data/push-tokens.json`) — overleeft een
  gewone procesherstart. Overleeft **geen** volledige container-redeploy
  tenzij dat pad op een persistent volume gemount is (nog niet gedaan —
  zie §6, punt 1).
- **`docs/MOBILE.md` §5**: bijgewerkt met de nieuwe `_JSON`-optie en
  `PUSH_TOKENS_PATH`-uitleg.
- **Daadwerkelijk uitgevoerd door de gebruiker**: `firebase-service-account.json`
  base64-encoded (PowerShell `[Convert]::ToBase64String(...)`) en als
  `FIREBASE_SERVICE_ACCOUNT_JSON` in Coolify's Production Environment
  Variables gezet voor de "BromeoRemote Server"-resource, daarna
  geredeployed.

## 5. Wat al geverifieerd is werkend — en wat nog niet

**Geverifieerd (via directe synthetische `/confirm`-POSTs, Antigravity
volledig omzeild, om de BromeoRemote-eigen pipeline geïsoleerd te testen):**

- Hook-config zelf correct (`~/.gemini/config/hooks.json` +
  `bromeoremote-hook.js`, matcher `"*"`, risk-filtering-regex in het script
  zelf — zie ANTIGRAVITY.md voor de exacte inhoud).
- `notifyForwardId` correct gezet op het bureaublad (`685460258`).
- **Eerste testronde gaf een vals-positieve directe "allow"** (binnen
  seconden, terwijl zelfs de veilige timeout-fallback altijd "deny" zou
  moeten zijn) — bleek te komen door **meerdere gelijktijdig draaiende,
  verouderde desktop-app-instanties** (overblijfsel van herhaaldelijk
  herbouwen/herstarten tijdens deze sessie). Opgelost door alle
  `BromeoRemote.exe`-processen te killen en precies één schone instantie te
  starten.
- **Na het opschonen**: een test wachtte correct de volle 60s timeout uit en
  viel terug op "deny" (geen valse positieve meer) — en de melding kwam
  **zichtbaar aan op de telefoon** (volledig scherm) tijdens die test.
- **Geluid ontbrak aanvankelijk** — Android bevriest een notificatiekanaal's
  geluidsinstelling permanent na de allereerste aanmaak
  (`notifee.createChannel` met dezelfde kanaal-ID doet daarna niets meer,
  ook al staat `sound: "default"` gewoon in de code —
  `mobile/src/notifications.ts`). Opgelost door de gebruiker: in de app,
  kaart "Meldingen" → knop "Meldingsgeluid aanpassen" (opent Android's eigen
  per-kanaal instellingenscherm) → geluid daar handmatig gezet.
- **Derde test: geluid werkt.**
- **Vierde test (End-to-End Hook verification):**
  Het universele hook-script `scripts/bromeoremote-hook.js` is toegevoegd aan de repository.
  Een live test is uitgevoerd waarbij de Antigravity `PreToolUse` hook-payload via stdin naar `scripts/bromeoremote-hook.js` werd gepiped.
  Het script heeft succesvol de commandoline en tool-parameters verwerkt, via HTTP POST verbinding gemaakt met `http://localhost:8973/confirm`, gewacht op de beslissing en de goedgekeurde uitkomst `{"decision":"allow"}` netjes in JSON-formaat geretourneerd op stdout.

## 6. Aanbevolen volgende stappen

1. **Persistent volume voor `PUSH_TOKENS_PATH` op Coolify.** Nu overleeft het
   token-bestand alleen een gewone herstart van de server, niet een volledige container redeploy.
   Mount een volume op `/app/data` (matcht de `WORKDIR /app` in `server/Dockerfile`) als dit permanent over redeploys heen bewaard moet blijven.
   token-bestand alleen een gewone herstart, niet een volledige redeploy.
   Mount een volume op `/app/data` (matcht de `WORKDIR /app` in
   `server/Dockerfile`) als dit echt permanent moet zijn.
3. **Overweeg**: als stap 1 een concrete fout oplevert (hook vuurt niet,
   payload klopt niet, decision komt niet aan), dat hier of in
   `docs/ANTIGRAVITY.md` vastleggen met de exacte foutmelding/log-regel —
   niet opnieuw vanaf nul redeneren.

## 7. Relevante bestanden

- `client/src/main/bridge.ts` — lokale HTTP-brug (`:8973`), `/notify` en
  `/confirm`, `resolvePending`.
- `client/src/main/main.ts` — `handleBridgeNotification`,
  `bromeo:bridge-decision` IPC-handler, start de bridge bij app-start.
- `client/src/renderer/app.ts` — `notifyForwardId`-doorstuurlogica,
  `answerActiveConfirm`, lokale confirm-UI als er geen doorstuur-ID is.
- `server/src/index.ts` — cases `"notify"`, `"notify-response"`,
  `"register-push-token"`.
- `server/src/push.ts` — FCM-verzending, `FIREBASE_SERVICE_ACCOUNT_JSON`/`_PATH`.
- `server/src/pushTokens.ts` — token-opslag, nu bestand-gebaseerd
  (`PUSH_TOKENS_PATH`).
- `mobile/src/push.ts` — FCM-token ophalen/registreren, achtergrond/
  voorgrond-push parsen.
- `mobile/src/notifications.ts` — notifee-kanalen (geluid/volledig-scherm),
  `openConfirmNotificationSettings`.
- `mobile/src/App.tsx` — case `"notify"`, `addNotification`,
  push-token-registratie bij opstarten.
- `~/.gemini/config/hooks.json` + `~/.gemini/config/bromeoremote-hook.js`
  (machine-lokaal, **niet** in deze repo) — de daadwerkelijke Antigravity-koppeling.
- `docs/ANTIGRAVITY.md` — hoe je de hook zelf instelt (volledige uitleg +
  voorbeeldscripts voor andere tools).
- `docs/MOBILE.md` §5 — hoe je FCM serverside instelt.
