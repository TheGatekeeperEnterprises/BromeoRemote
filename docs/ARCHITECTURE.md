# BromeoRemote — Architectuur

## Overzicht

```
┌──────────────────────┐        WebSocket (signaling)        ┌──────────────────────┐
│   BromeoRemote App    │ ───────────────────────────────────▶│  Signaling Server     │
│   (Host, deelt scherm)│◀─────────────────────────────────── │  (jouw VPS, Node.js)  │
└──────────┬────────────┘                                     └───────────┬───────────┘
           │                                                              │
           │              WebRTC (P2P, DTLS/SRTP versleuteld)            │
           │  video (scherm) + datachannels (muis/toetsenbord,            │
           │  bestanden, klembord, chat, systeemcommando's)               │
           │                                                              │
┌──────────▼────────────┐        WebSocket (signaling)        ┌──────────▼───────────┐
│   BromeoRemote App     │ ───────────────────────────────────▶│  (zelfde server)      │
│   (Viewer, bestuurt)   │◀─────────────────────────────────── │                       │
└───────────┬────────────┘                                     └───────────────────────┘
            │
            │  Lukt directe P2P niet (symmetrische NAT/firewall)?
            ▼
   ┌─────────────────────┐
   │  TURN relay (coturn) │  ← zelfde VPS, routeert versleuteld verkeer 1-op-1 door
   └─────────────────────┘
```

## Componenten

### 1. `server/` — Signaling server (te hosten op jouw VPS)

Rol: het equivalent van RustDesk's `hbbs`. Draait 24/7 op je VPS.

- Geeft elk geïnstalleerd BromeoRemote-apparaat een uniek **BromeoRemote-ID** (9 cijfers, zoals TeamViewer).
- Houdt een **eenmalig sessiewachtwoord** (roteert elke keer de app opnieuw start) of een **vast onbeheerd wachtwoord** (door gebruiker ingesteld) bij per apparaat.
- Wanneer een viewer verbinding wil maken: controleert ID + wachtwoord, en **brokered** de WebRTC-handshake (SDP offer/answer + ICE-candidates) tussen host en viewer via WebSocket.
- Zelf ziet deze server **nooit** het scherm, toetsaanslagen of bestanden — enkel de korte handshake-berichten om de P2P-verbinding op te zetten.
- Stateless per sessie: geen scherm-/inputdata passeert deze server.

### 2. TURN relay (coturn — bestaande, industriestandaard open-source software)

Rol: het equivalent van RustDesk's `hbbr`. Springt in wanneer een directe P2P-verbinding niet lukt (typisch bij bedrijfsnetwerken/strikte firewalls). We herbouwen geen eigen TURN-protocol — dat is precies waar coturn (RFC 5766) al robuust en veilig voor is; zelf een TURN-server bouwen is onnodig risico. Zie `docs/DEPLOY.md` voor installatie op je VPS.

### 3. `client/` — De BromeoRemote-applicatie (Electron + TypeScript)

Eén app, twee rollen tegelijk mogelijk:

- **Host-modus**: deelt het eigen scherm, ontvangt en voert muis-/toetsenbordacties uit die de viewer stuurt.
  - Schermcapture: Electron `desktopCapturer` → `getUserMedia` → WebRTC `MediaStreamTrack`.
  - Input-injectie: `@nut-tree-fork/nut-js` (cross-platform, native) zet ontvangen muis-/toetsenbordevents om in echte OS-acties.
  - Toont altijd een **acceptatiedialoog** bij inkomende verbindingen (tenzij onbeheerde toegang expliciet is ingeschakeld) en een permanente **statusbalk** zolang er iemand meekijkt/bestuurt.
- **Viewer-modus**: verbindt met een ander apparaat via ID + wachtwoord, toont het scherm, stuurt muis-/toetsenbordinput, kan bestanden uploaden/downloaden en klembord synchroniseren.

### Dataverkeer via WebRTC

- **1 video-track** — het gedeelde scherm (H.264/VP8, hardware-versneld waar mogelijk). Kan tijdens de sessie zonder heronderhandeling gewisseld worden naar een ander scherm (`RTCRtpSender.replaceTrack`) bij multi-monitor.
- **1 DataChannel `control`** — muis-/toetsenbordevents (JSON, laag volume, hoge frequentie). De **host** past deze events alleen toe als de sessie niet "alleen-kijken" is — afgedwongen op basis van wat de host bij het accepteren zelf heeft vastgelegd, niet op wat de viewer beweert.
- **1 DataChannel `files`** — chunked bestandsoverdracht (binary).
- **1 DataChannel `clipboard`** — tekst-/klembordsynchronisatie.
- **1 DataChannel `chat`** — tekstchat tijdens de sessie.
- **1 DataChannel `system`** — systeemcommando's: schermenlijst/-wissel (multi-monitor) en een herstartverzoek (met bevestigingsdialoog aan de viewer-kant).

Alle WebRTC-verkeer is **standaard end-to-end versleuteld (DTLS-SRTP)** — dat is een ingebouwde eigenschap van het WebRTC-protocol, niet iets wat we zelf hoeven te implementeren.

### 3b. `mobile/` — De Android-viewer (React Native + TypeScript)

Viewer-only tegenhanger van `client/`: geen host-modus, geen scherm delen — alleen verbinden met een ander apparaat en dat bekijken/besturen. Deelt zo veel mogelijk logica met `client/` (protocol, signaling, sessie-opzet), handmatig overgezet naar React Native's runtime (`react-native-webrtc` i.p.v. browser-WebRTC, `js-sha256` i.p.v. Web Crypto — Hermes heeft geen `crypto.subtle`). Touch-naar-muis-vertaling gebeurt via React Native's `PanResponder`. Zie `docs/MOBILE.md` voor bouwen/draaien en de bekende beperkingen (Android-only, geen achtergrond-pushmeldingen).

### 4. Lokale agent-notificatiebrug (`client/src/main/bridge.ts`)

Een kleine HTTP-server die **uitsluitend op `127.0.0.1` luistert** (nooit bereikbaar van buiten dit apparaat), zodat lokale tools (Google Antigravity, Claude Code hooks, eigen scripts) een melding of blokkerend bevestigingsverzoek in BromeoRemote kunnen zetten. Zie `docs/ANTIGRAVITY.md` voor de volledige werking, API en voorbeelden.

### 5. Lokale opslag & beveiliging

- **Apparaat-ID, wachtwoord-hashes, thema, instellingen** — gewoon JSON in Electron's `userData`-map. Wachtwoorden zelf worden nooit opgeslagen, enkel SHA-256-hashes.
- **Opgeslagen apparaten (adresboek) en het TOTP-secret voor 2FA** — dit zijn actieve inloggegevens, dus die staan **versleuteld** via Electron's `safeStorage` (Windows DPAPI / macOS Keychain / Linux Secret Service), niet als platte tekst in dat JSON-bestand.
- **2FA (TOTP, RFC 6238)** — eigen implementatie op Node's `crypto` (HMAC-SHA1), geen externe library, compatibel met Google Authenticator/Authy.
- **Automatische updates** — `electron-updater`, zelf gehost op je eigen VPS (generic provider, geen GitHub-account nodig). Alleen de NSIS-installer werkt zichzelf bij; de portable exe heeft geen vaste installatielocatie en slaat dat bewust over.

## Waarom Electron + WebRTC

- Sluit aan bij je bestaande TypeScript/Next.js-stack (BromeoFlow) — herbruikbare kennis en eventueel herbruikbare auth/UI-patronen.
- WebRTC geeft **gratis**: NAT-traversal (ICE/STUN/TURN), encryptie (DTLS/SRTP), adaptieve bitrate/kwaliteit — dingen die TeamViewer/AnyDesk zelf met veel meer werk in een eigen protocol hebben gebouwd.
- Cross-platform: dezelfde Electron-codebase draait op Windows, macOS en Linux.
