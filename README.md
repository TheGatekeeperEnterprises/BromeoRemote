# BromeoRemote — Access Anywhere

Een eigen, cross-platform remote desktop-applicatie (TeamViewer/AnyDesk/RustDesk-alternatief): scherm delen en op afstand besturen, met je eigen signaling/relay-infrastructuur, zonder licentiekosten — en een aantal dingen die TeamViewer/AnyDesk niet aanbieden (agent-notificatiebrug, ingebouwde 2FA zonder abonnement, volledig zelf gehost).

Zie [`docs/RESEARCH.md`](docs/RESEARCH.md) voor het marktonderzoek, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) voor hoe het in elkaar zit, [`docs/ROADMAP.md`](docs/ROADMAP.md) voor wat er is gebouwd en nog kan komen, [`docs/DEPLOY.md`](docs/DEPLOY.md) voor je eigen server/TURN-relay/updates hosten, [`docs/ANTIGRAVITY.md`](docs/ANTIGRAVITY.md) voor de agent-notificatiebrug (Google Antigravity, Claude Code, of je eigen scripts), en [`docs/MOBILE.md`](docs/MOBILE.md) voor de Android-viewer-app.

## Projectstructuur

```
Bromeo Remote/
  client/     Electron-app (Windows/macOS/Linux) — de BromeoRemote-applicatie zelf
  mobile/     React Native-app (Android) — mobiele viewer om andere pc's te bekijken/besturen
  server/     Signaling server (Node.js) — koppelt apparaten via ID + wachtwoord
  website/    Publieke website voor bromeoremote.com (downloads, contact, Coolify deploy)
  docs/       Onderzoek, architectuur, roadmap, deployment, agent-koppeling, mobile
  logo.png    Branding
```

## Snel starten (lokaal ontwikkelen)

**1. Signaling server:**

```bash
cd server
npm install
npm run dev
```

Draait standaard op `ws://localhost:21116`.

**2. Client (in een nieuwe terminal):**

```bash
cd client
npm install
npm start
```

Dit bouwt de app en opent het BromeoRemote-venster. Start de client twee keer (op twee apparaten, of lokaal met `--user-data-dir` om een tweede identiteit te simuleren) om een verbinding tussen "dit apparaat" en "verbinden met een ander apparaat" te testen.

> **Als het venster meteen crasht met een `app.getPath`-foutmelding:** je terminal heeft de omgevingsvariabele `ELECTRON_RUN_AS_NODE=1` staan (soms door een andere tool gezet). Verwijder die voor deze terminal-sessie, bv. in PowerShell: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`, en start opnieuw.

**Een echte .exe bouwen** (portable + installer, geen dev-omgeving nodig):

```bash
cd client
npm run dist
```

Dit produceert in `client/release/`:
- `BromeoRemote-Setup.exe` — portable, direct uitvoerbaar, geen installatie
- `BromeoRemote-Installer.exe` — echte installer, ondersteunt automatische updates (zie `docs/DEPLOY.md` §5)

## Functies

**Kernfunctionaliteit**
- Verbinden via een uniek BromeoRemote-ID + wachtwoord (roterend, of vast voor onbeheerde toegang, optioneel met 2FA)
- Live schermdeling met volledige muis-/toetsenbordbesturing op afstand, of "alleen bekijken" — door de host afgedwongen, niet enkel verborgen in de viewer-UI
- Bestandsoverdracht, klembord-synchronisatie en chat tijdens de sessie
- Sessie-opname (lokaal WebM) en een automatische sessie-samenvatting na afloop
- Multi-monitor: wissel tijdens de sessie tussen de schermen van de host
- Altijd-zichtbare "je wordt bekeken"-balk met een directe sessie-beëindigen + wachtwoord-wijzigen-knop
- Privacyscherm (curtain mode): schakelt het fysieke beeldscherm van de host uit tijdens een sessie
- End-to-end versleuteld (WebRTC DTLS/SRTP) — de signaling server ziet nooit scherm, toetsaanslagen of bestanden

**Beheer & gemak**
- Adresboek: opgeslagen/vertrouwde apparaten met groepen, favorieten en één-tik verbinden (versleuteld bewaard)
- Wake-on-LAN, externe herstart en externe vergrendeling (Lock) + automatische herverbinding na herstart
- Automatische updates (zelf gehost, geen abonnement)

**Voor wie ook met AI-agents werkt**
- **Agent-notificatiebrug**: lokale tools zoals Google Antigravity of Claude Code kunnen BromeoRemote een melding of blokkerend bevestigingsverzoek sturen zodra ze jouw aandacht nodig hebben — inclusief doorsturen naar een ander apparaat, met gestructureerd commando + risiconiveau. Zie [`docs/ANTIGRAVITY.md`](docs/ANTIGRAVITY.md).

**Onderweg**
- **Mobiele app (Android)**: bekijk en bestuur een pc vanaf je telefoon — verbinden via ID + wachtwoord, video mét systeemgeluid, tik-modus én muis-modus (trackpad-stijl met zichtbare cursor, inclusief in-/uitzoomen), en agent-bevestigingen die ook tijdens een sessie bereikbaar blijven. Eigen app-icoon en een donker opstart-/laadscherm met logo. Optioneel: echte pushmeldingen (FCM) zodat bevestigingsverzoeken ook aankomen als de app dicht staat. **Werkt ook andersom**: laat een pc jouw telefoon bekijken en bedienen (schermdelen + echte tik-/veegbediening via een Accessibility Service). Zie [`docs/MOBILE.md`](docs/MOBILE.md).

Volledige featurelijst, wat nog gepland staat, en vergelijking met TeamViewer/AnyDesk/RustDesk: [`docs/RESEARCH.md`](docs/RESEARCH.md) en [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Voor het internet (buiten je eigen wifi)

Standaard werkt dit alleen op hetzelfde netwerk. Voor verbindingen overal vandaan host je zelf de signaling server + een TURN-relay (en optioneel: automatische updates) op een VPS — stappenplan in [`docs/DEPLOY.md`](docs/DEPLOY.md).
