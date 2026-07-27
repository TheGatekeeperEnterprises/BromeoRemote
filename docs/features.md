# Competitief feature-onderzoek: Parsec, Splashtop, Reemo vs. BromeoRemote

Onderzoeksdatum: 2026-07-27. Doel: een volledige, uitgebreide feature-inventarisatie van drie concurrenten (Parsec, Splashtop, Reemo — desktop + mobiel), vergeleken met wat BromeoRemote nu al heeft, met een score per ontbrekende feature om te bepalen wat we als eerste bouwen.

Methodologie: elke competitor-claim hieronder komt uit een web-search of een directe fetch van de officiële site/support-docs/appstore-vermeldingen (bronnen onderaan elke sectie). BromeoRemote's eigen feature-lijst komt niet uit geheugen maar uit een verse scan van de daadwerkelijke broncode (`client/src`, `mobile/src`, `server/src`, `docs/*.md`) — dus dit document is zo accuraat als de code op het moment van schrijven.

---

## 1. Parsec

**Positionering**: low-latency P2P game-streaming/creative-workstation tool. Niet gebouwd als IT-supporttool — mist bewust dingen als file transfer, unattended-access-beheer en session recording.

### Performance & video
- Peer-to-peer verbindingen (bypassen Parsec's eigen infrastructuur waar mogelijk), "near-zero latency"
- Resoluties tot 4K, 4:4:4 kleur, tot 240 FPS (60 FPS haalbaar op 4K)
- Proprietary streaming-tech voor minder gedropte frames
- Virtual Display Driver (VDD, Teams/Warp-tier): tot 3 extra virtuele monitors op de host via Windows IddCx-API, tot 4K/240Hz — nuttig op headless/GPU-servers zonder fysiek scherm
- Privacy Mode (Teams/Warp): schakelt de fysieke schermen van de Windows-host uit zodra iemand verbindt, en host gaat naar het vergrendelscherm zodra de laatste guest disconnect

### Input
- Controller/gamepad-support, keyboard mapping
- Pressure-sensitive pen / Wacom-tablet support (Warp-tier)
- Microphone passthrough (client mic → host) via Virtual USB Driver (Windows-host)
- USB device passthrough (v3.10+) via dezelfde virtuele USB-driver
- Clipboard sync (copy/paste tussen client en host)
- Multi-monitor support (Warp-tier, meerdere displays tegelijk beheren)

### Samenwerking
- Meerdere gebruikers tegelijk verbonden met dezelfde machine (co-op gaming, "over-the-shoulder" meekijken, creative review)
- Guest-permissies los instelbaar (standaard alleen controller-rechten; keyboard/mouse moet expliciet gegeven worden door de host)
- "Approved Apps": host kan de guest's controller pauzeren zodra een niet-goedgekeurde app in beeld komt
- Guest access voor teams (events/onderzoek, tijdelijke toegang)

### Security
- SOC 2 Type 2 gecertificeerd
- MFA voor accounts, Enterprise SSO (SAML)
- Yubikey passthrough
- AES-128 encryptie (lager dan Splashtop's AES-256, zie Splashtop-sectie)

### Wat Parsec NIET heeft (expliciet bevestigd via onderzoek)
- **Geen ingebouwde file transfer** — enige workaround is cloud storage of shared folders
- Geen session recording
- Geen unattended-access-beheerconsole
- Geen mass-deployment tooling
- Geen ingebouwde Wake-on-LAN (alleen community-scripts zoals "quick-parsec")
- Android-app is expliciet "experimenteel" met bekende bugs (Android 9+, OpenGL ES3 vereist)
- Geen chat-functie in de eigenlijke app (verwijst naar Discord-integratie in plaats daarvan)

**Bronnen**: [parsec.app](https://parsec.app/), [parsec.app/features](https://parsec.app/features), [Parsec Support: VDD Overview](https://support.parsec.app/hc/en-us/articles/32381178803604-VDD-Overview-Prerequisites-and-Installation), [Parsec Support: Privacy Mode](https://support.parsec.app/hc/en-us/articles/32361381211284-Privacy-Mode), [Parsec Support: Hosting and Permissions](https://support.parsec.app/hc/en-us/articles/32381747079572-Hosting-and-Permissions), [Parsec Blog: Microphone passthrough](https://parsec.app/blog/now-available-microphone-passthrough), [SoftwareSuggest: Parsec 2026](https://www.softwaresuggest.com/parsec), [Splashtop: Best Parsec Alternative 2026](https://www.splashtop.com/compare/parsec-alternative)

---

## 2. Splashtop (Business/Enterprise/SOS)

**Positionering**: de meest "IT-support"-georiënteerde van de drie — expliciet gebouwd voor helpdesks, MSP's en bedrijven, met de breedste feature-set van alle drie.

### Performance & video
- Tot 240 fps, 4K streaming, 4:4:4 kleuraccuraatheid op bepaalde tiers
- HD-audio streaming van host naar viewer
- Multi-to-multi monitor: **alle monitors van de host tegelijk bekijken** over meerdere lokale monitors — niet alleen wisselen tussen monitors
- Tot 3 gelijktijdige gebruikers op één computer

### Bestanden & printen
- File transfer (bidirectioneel)
- **Remote print**: bestanden op de remote pc afdrukken op je lokale printer, zonder het bestand eerst te hoeven overzetten

### Samenwerking
- Chat (voor, tijdens en na een sessie)
- **Whiteboard**: interactieve annotatie/tekenen tijdens presentaties of training
- "Share My Screen": je eigen scherm laten zien aan de remote gebruiker terwijl je een ander apparaat bedient (omgekeerde richting)
- Session recording (video-opname van support-sessies, centraal opslaanbaar op On-Prem-tier)

### Mobiel (Android/iOS)
- Android: volledige remote control, file transfer, bulk-acties (scripts, APK-install), **real-time voice call**, clipboard sync, remote annotaties, device inventory
- iOS: alleen attended, view-only screen sharing (Apple-platformbeperking — geen echte controle mogelijk)
- Twee touch-modi: **Touch mode** (tik = klik op exacte positie) en **Mouse/Trackpad mode** (device wordt een trackpad, zichtbare cursor); één/twee-vinger tap = links/rechtsklik, twee-vinger drag = scrollen, pinch = zoomen — vrijwel exact hetzelfde concept als BromeoRemote's tap/mouse-mode toggle
- Los betaalde Gamepad & Shortcuts add-on voor Android/iPad (virtuele joystick, keyboard shortcuts)

### Session- & apparaatbeheer
- Remote reboot (via webconsole of app, ook zonder actieve sessie)
- **Remote wake** (Wake-on-LAN, mits een ander apparaat op hetzelfde netwerk wakker is)
- Scheduled remote access (tijdvensters instellen via admin console)
- Gebruikers-/apparaatbeheer: groepen, permissies, logging van connecties/bestandsoverdrachten/chats

### Security
- 256-bit AES encryptie (hoger dan Parsec's 128-bit), TLS
- 2FA (authenticator-app, **QR-code setup**, geen SMS)
- **Trusted devices**: eenmaal vertrouwd apparaat hoeft geen 2FA-code meer in te voeren
- SSO (SAML 2.0), device-authenticatie
- HIPAA/CCPA/GDPR/SOC 2-compliant

**Bronnen**: [splashtop.com/features](https://www.splashtop.com/features), [Splashtop: remote support mobile devices](https://www.splashtop.com/blog/remote-support-mobile-devices), [Splashtop Support: Android gestures](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724403-Introduction-to-Android-gestures), [Splashtop Support: iOS gestures](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724363-Introduction-to-iOS-gestures-iPad-iPhone), [Splashtop Support: 2FA setup](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724923-How-do-I-set-up-two-step-verification-2FA), [Splashtop Support: trusted devices](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/360054614071-How-to-manage-2FA-trusted-devices), [Splashtop press: gamepad add-on](https://www.splashtop.com/press/1-remote-desktop-leader-splashtop-introduces-configurable-shortcuts-gamepad-ability-create-keyboard-shortcuts-mouse-controls-virtual-joysticks-optimizing-favorite-apps), [Businessnewsdaily: Splashtop review 2026](https://www.businessnewsdaily.com/16225-splashtop.html)

---

## 3. Reemo (reemo.io, Reemo SAS)

**Positionering**: browser-first, zero-install remote desktop met enterprise zero-trust security. Geen native mobiele app — mobiel gebruik gaat via de browser.

### Performance & video
- Near-zero latency, 4K @ 60FPS, 4:4:4 chroma, meerdere monitors
- HEVC-codec-optie voor bandbreedte-optimalisatie
- GPU-passthrough support (NVIDIA/AMD) voor zware workloads
- Privacy screen-functionaliteit, popup/split-view schakelen

### Toegang
- **Volledig browser-based**: geen installatie nodig, werkt in Chrome/Safari/Firefox, ook vanaf mobiel (browser, geen native app)
- Ook client-software beschikbaar voor Windows/macOS/Linux
- Reemo Thin Client: zet elke computer om in een lightweight, dedicated werkstation-OS
- Reemo Containers: graphical containerization + protocol-isolatie voor extra beveiliging

### Device forwarding
- Webcam- en microfoon-forwarding
- Drawing tablet support met pen-drukgevoeligheid
- Gamepad-compatibiliteit

### Samenwerking
- Multi-user support voor real-time samenwerking
- Session recording, screen sharing
- Custom branded interfaces + dedicated URL's (white-label)

### Security & beheer
- End-to-end encryptie, Zero Trust-architectuur (WebRTC, WebSocket, DTLS)
- MFA, SSO (SAML), LDAP-integratie, SCIM user provisioning
- Role-based user/groep/subgroep-beheer
- Usage scheduling (tijdvensters)
- ISO 27001, SOC 2, TPN Gold-certificeringen

### Wat Reemo NIET expliciet heeft
- Geen bevestigde native iOS/Android-app (browser-only op mobiel)
- Geen remote print gevonden in onderzoek
- Geen expliciete chat-functie gevonden (wel "collaboration tools" in algemene zin)

**Bronnen**: [reemo.io](https://reemo.io/), [reemo.io/reemo-desktop](https://reemo.io/reemo-desktop/), [reemo.io/secure-remote-desktop](https://reemo.io/secure-remote-desktop/), [Reemo blog: 15 remote desktop alternatives](https://blog.reemo.io/15-remote-desktop-software-options-from-free-to-premium-2025-guide/), [Reemo blog: Parsec vs Reemo](https://blog.reemo.io/best-parsec-alternative/), [Capterra: Reemo](https://www.capterra.com/p/10025394/Reemo/)

---

## 4. BromeoRemote — huidige feature-inventaris (geverifieerd in de code, juli 2026)

Legenda: **[D]** desktop (`client/`, Electron, **alleen Windows gebouwd** — geen mac/linux build target in `package.json` ondanks cross-platform libraries), **[M]** mobiel (`mobile/`, **alleen Android** — geen iOS-build), **[Both]** beide, **[S]** server.

### Video/streaming
- WebRTC screendeling, DTLS-SRTP versleuteld **[Both]**
- Codec-voorkeur (Scherp=VP9/screen-content-coding, Snel=H264/hardware) **[D]**
- Adaptive bitrate-engine (continue bandbreedte-aanpassing + resolution-scale-down als laatste redmiddel), `degradationPreference: maintain-resolution` **[Both]**
- Handmatige kwaliteitscaps (Auto/Hoog/Laag) **[Both]**
- **Resolutie-voorkeur (Scherp/Snel)** — live herstart van de capture op andere resolutie, zonder reconnect **[D]** (net vandaag gebouwd)
- Multi-monitor wisselen (niet gelijktijdig bekijken) **[Both]**
- Eén-specifiek-venster delen ("programma besturen") **[D uitvoerend, M initiërend]**
- **Dual-window mode**: twee vensters tegelijk, aspect-locked getiled/gecropt naar telefoon-oriëntatie, met live re-crop bij rotatie — vergelijkbaar met niemand van de drie concurrenten
- Live cursor-vorm-mirroring (pijl/hand/tekst/resize/etc, Windows `GetCursorInfo`) **[D→Both]**
- Encoder-limitation diagnostiek (cpu/bandwidth/other zichtbaar in viewer-statsregel)
- Failsafe/periodieke ICE-restart tegen de bekende ~45s TURN-drop-bug (mitigatie, geen fix — zie `docs/47seconds.md`)

### Input
- Muis (absolute positionering), toetsenbord (volledige mapping + directe tekst-invoer)
- **Twee touch-modi op mobiel** (tap-mode / mouse-trackpad-mode) — functioneel vrijwel identiek aan Splashtops Touch/Mouse mode
- Snelkoppelingen-paneel (Taakbeheer, Alt+Tab, Win+R, Ctrl+C/V, Ctrl+Alt+Del)
- Mobiel-als-host: Accessibility-service-gebaseerde gesture-vertaling (geen keyboard-support als host, v1-beperking)
- **Geen gamepad/controller-support**
- **Geen echte IME** (alleen tekst-plak-paneel)
- Ctrl+Alt+Del: geïmplementeerd maar **bevestigd niet-werkend** (SendSAS heeft geen zichtbaar effect)

### Bestanden & klembord
- Bidirectionele file transfer, chunked over eigen DataChannel, drag&drop (D) / systeem-picker (M) **[Both]** — **Parsec heeft dit helemaal niet**
- Klembord-sync (tekst, knop-getriggerd, geen continue achtergrond-sync) **[D]**

### Chat & samenwerking
- Tekst-chat over eigen DataChannel **[Both, mobiel alleen als viewer]**
- **Geen whiteboard/annotatie**
- **Geen simultane multi-viewer sessies** (architectuur is 1 host ↔ 1 viewer per sessie)
- **Geen "share my screen"-omgekeerde richting**

### Opname & geschiedenis
- Lokale sessie-opname (MediaRecorder → WebM), handmatig of automatisch **[D only]**
- Sessiegeschiedenis (peer, duur, bestanden) **[Both]** — zit ook al op mobiel, ondanks verouderde ROADMAP-notitie die het tegendeel beweert
- Sessienotities (vrije tekst) **[D only]**

### Notificaties — uniek t.o.v. alle drie concurrenten
- **Agent-Notification Bridge**: lokale HTTP-bridge (`127.0.0.1:8973`) voor AI coding-agent hooks (Antigravity, Claude Code, generieke CI/scripts), met `/notify` en blocking `/confirm` — doorgestuurd naar mobiel via de signaling-server, met risk-level badges
- Echte push-notificaties via FCM (werken ook als de app dicht is), server stuurt zowel WebSocket als FCM tegelijk met dedupe
- In-app notificatiebel + geschiedenis **[D]**

### AI Buddy — uniek t.o.v. alle drie concurrenten
- In-sessie AI-chatassistent (eigen OpenAI-key van de gebruiker, `gpt-4o-mini`), optioneel met screenshot van het huidige beeld voor visuele troubleshooting **[Both]**

### Security
- BromeoRemote-ID + roterend sessiewachtwoord, of vast unattended-wachtwoord **[Both]**
- Expliciete accept/decline-dialoog per inkomende verbinding (60s timeout) **[Both]**
- View-only vs. volledige controle, **host-enforced**, per opgeslagen apparaat **[Both]**
- "Alleen vertrouwde apparaten"-toggle
- **TOTP 2FA (RFC 6238)** — eigen implementatie, **geen QR-code, alleen handmatige secret-invoer** (Splashtop/industry-standaard heeft wel QR)
- E2E-encryptie via WebRTC DTLS-SRTP (standaard, niet zelfgebouwd)
- Versleutelde lokale opslag via Electron `safeStorage` (D); mobiel gebruikt onversleutelde AsyncStorage met alleen wachtwoord-hashes (bewuste kleinere scope)
- **Curtain/privacy-mode** (fysiek scherm uit, Windows) — vergelijkbaar met Parsec's Privacy Mode, maar zonder de "ga naar lockscreen bij laatste disconnect"-toevoeging
- Wallpaper verbergen (los van curtain mode)
- Block remote input (host's eigen muis/toetsenbord uitschakelen tijdens sessie)
- Remote lock, remote restart met auto-reconnect
- Panic-knop (sessie beëindigen + wachtwoord roteren) — geen van de drie concurrenten heeft dit expliciet
- Server-side rate limiting, CSP-hardening

### Sessiebeheer
- Idle-timeout, failsafe-reconnect, auto-reconnect na restart
- **Wake-on-LAN — [D only]**, bewust niet op mobiel gebouwd (LAN-only nut is beperkt vanaf mobiele data)
- Adresboek met favorieten/groepen (D); favorieten zonder groepen (M)
- Mini-controller-venster (D), systray-icoon, auto-updates (D)

### Wat expliciet buiten scope is (uit eigen ROADMAP.md)
- Geen teams/organisaties, admin-rollen, audit-log
- Geen remote printing
- Geen VPN/site-to-site networking
- Geen iOS-app

---

## 5. Vergelijkingsmatrix

| Feature | Parsec | Splashtop | Reemo | BromeoRemote |
|---|---|---|---|---|
| File transfer | ❌ | ✅ | ✅ | ✅ |
| Remote print | ❌ | ✅ | ❌ | ❌ |
| Chat | ❌ (Discord i.p.v.) | ✅ | ~ (onduidelijk) | ✅ |
| Session recording | ❌ | ✅ (centraal, On-Prem) | ✅ | ✅ (alleen lokaal) |
| Whiteboard/annotatie | ❌ | ✅ | ❌ | ❌ |
| Multi-viewer / gelijktijdige samenwerking | ✅ (kernfeature) | ✅ (tot 3) | ✅ | ❌ |
| Multi-monitor gelijktijdig bekijken | ~ (Warp, wisselen) | ✅ | ✅ | ❌ (alleen wisselen) |
| Clipboard sync | ✅ | ~ | ~ | ✅ (handmatig) |
| 2FA | ✅ | ✅ (+ QR + trusted device) | ✅ (+ SSO/LDAP/SCIM) | ✅ (geen QR) |
| Curtain/privacy-mode | ✅ | ~ | ✅ (privacy screen) | ✅ |
| Block remote input | ~ | ~ | ~ | ✅ |
| Wake-on-LAN | ❌ (community only) | ✅ | ~ | ✅ (desktop only) |
| Gamepad/controller | ✅ | ✅ (addon) | ✅ | ❌ |
| Mic/webcam/USB passthrough | ✅ (mic+USB) | ~ | ✅ (webcam+mic+tablet) | ❌ |
| Browser-only zero-install | ~ (deels) | ❌ | ✅ (kern) | ❌ |
| Native mobiele app (echt, geen browser) | ✅ (experimenteel) | ✅ (volwassen) | ❌ | ✅ |
| Mobiel: telefoon als host besturen | ❌ | ✅ (Android) | ❌ | ✅ (Android, v1) |
| Push notifications (app dicht) | ❓ onbekend | ❓ onbekend | ❓ onbekend | ✅ (FCM, geverifieerd) |
| AI-hook/agent-notificatiebrug | ❌ | ❌ | ❌ | ✅ (uniek) |
| In-sessie AI-assistent | ❌ | ❌ | ❌ | ✅ (uniek) |
| Panic-knop (end+rotate password) | ❌ | ❌ | ❌ | ✅ (uniek) |
| Enterprise SSO/LDAP/SCIM/RBAC | ✅ | ✅ | ✅ | ❌ (bewust) |
| Dual-window tiled sharing | ❌ | ❌ | ❌ | ✅ (uniek) |
| Live cursor-vorm mirroring | ❓ | ❓ | ❓ | ✅ |

✅ = bevestigd aanwezig · ❌ = bevestigd afwezig · ~ = deels/onduidelijk uit onderzoek · ❓ = niet gevonden in onderzoek (waarschijnlijk afwezig of niet publiek gedocumenteerd)

**Observatie**: BromeoRemote heeft al vijf features die geen van de drie concurrenten heeft (Agent-Notification Bridge, in-sessie AI Buddy, panic-knop, dual-window tiled sharing, resolutie-livewisseling zonder reconnect). De echte gaten liggen vooral bij **multi-viewer samenwerking**, **whiteboard/annotatie**, **gelijktijdig multi-monitor bekijken**, en **device-passthrough (mic/webcam/USB)** — stuk voor stuk dingen die alle drie concurrenten wél hebben.

---

## 6. Score & bouwvolgorde

**Scoreformule**: `Score = (Impact × 2) + Fit + Gemak`, elk op een schaal van 1–5, max 25.

- **Impact**: hoeveel dit een echte concurrentie-kloof dicht en hoeveel waarde het toevoegt voor BromeoRemote's gebruikers (dubbel gewogen, want dit is het belangrijkste).
- **Fit**: hoe goed het past bij BromeoRemote's huidige positionering (persoonlijke/kleine-teams remote support, TeamViewer-achtig — niet gaming, niet enterprise).
- **Gemak**: hoe makkelijk het te bouwen is gegeven de bestaande architectuur (WebRTC DataChannels voor chat/klembord/bestanden liggen er al, `protocol.ts`-patroon voor nieuwe system-commands, etc.) — 5 = makkelijk, 1 = zeer zwaar.

| # | Feature | Impact | Fit | Gemak | Score | Concurrenten die dit hebben |
|---|---|---|---|---|---|---|
| 1 | **Meerdere gelijktijdige viewers op één host** (samenwerking/meekijken) | 5 | 4 | 2 | **16** | Parsec, Splashtop, Reemo |
| 2 | **Whiteboard/annotatie-overlay tijdens sessie** | 3 | 4 | 4 | **14** | Splashtop |
| 3 | Browser-based zero-install viewer (naast bestaande apps) | 4 | 3 | 2 | 13 | Reemo (kern), deels Parsec |
| 3 | QR-code voor TOTP 2FA-setup | 2 | 4 | 5 | 13 | Splashtop |
| 3 | Gelijktijdig meerdere monitors bekijken (i.p.v. wisselen) | 3 | 4 | 3 | 13 | Splashtop, Reemo, deels Parsec |
| 6 | "Trust this device" (2FA overslaan op vertrouwd toestel) | 2 | 4 | 4 | 12 | Splashtop |
| 6 | Remote print | 3 | 4 | 2 | 12 | Splashtop |
| 6 | Microfoon-passthrough (client mic → host) | 3 | 3 | 3 | 12 | Parsec, Reemo |
| 6 | Two-way voice intercom tijdens sessie | 3 | 3 | 3 | 12 | Splashtop (Android SOS) |
| 10 | Wake-on-LAN op mobiel | 2 | 3 | 4 | 11 | Splashtop |
| 11 | Server-side/centraal opgeslagen sessie-opname | 2 | 2 | 2 | 8 | Splashtop (On-Prem), Reemo |
| 11 | Gamepad/controller-passthrough | 2 | 1 | 3 | 8 | Parsec, Splashtop, Reemo |
| 13 | Enterprise SSO/LDAP/SCIM/admin-console | 3 | 1 | 1 | 8 | Splashtop, Reemo |
| 14 | Generieke USB-device-passthrough | 2 | 2 | 1 | 7 | Parsec |

### Toelichting bij de top-scorer

**#1 — Meerdere gelijktijdige viewers op één host (score 16)** scoort het hoogst puur op impact: dit is de kernfeature die alle drie concurrenten delen en BromeoRemote helemaal mist. Het past ook goed bij realistische scenario's (een collega laten meekijken, samen aan iets werken, een tweede persoon laten helpen bij een support-sessie).

**Eerlijkheidsclausule over "Gemak"**: dit is wel de zwaarste bouwklus op de lijst (score 2/5 voor gemak). BromeoRemote's hele sessie-model is nu 1-op-1 (één `PeerSession`/host↔viewer per sessie, zichtbaar door de vele `currentSession`-singleton-patronen in zowel `client/src/renderer/session.ts` als `mobile/src/session.ts`). Dit ondersteunen betekent niet "een instelling omzetten" maar een echte architectuurwijziging: de host moet zijn capture-stream naar meerdere `RTCPeerConnection`-objecten tegelijk kunnen sturen, het signaling-protocol moet meerdere actieve viewer-ID's per host bijhouden in plaats van één, en het permissiemodel (`SessionPermissions`) moet per-viewer worden in plaats van per-sessie. Dat is een project van meerdere dagen, niet een middagklus zoals de codec/resolutie-toggles van vandaag.

Gegeven die score-uitkomst: **we bouwen 'm als eerste**, zoals gevraagd — maar wel als een apart, gefaseerd project (bijv. eerst view-only extra kijkers toestaan, daarna pas gedeelde controle-permissies per viewer), niet als één grote big-bang-verandering. Zeg het maar wanneer je wil starten, dan zet ik een concreet implementatieplan op.

### Runner-up als "snelle winst" alternatief

Als je liever met iets kleiners begint terwijl je nadenkt over de multi-viewer-architectuur: **whiteboard/annotatie-overlay (score 14)** is de op één na hoogst scorende feature én qua bouwwerk vergelijkbaar met de features die vandaag al gebouwd zijn (tekenlijnen syncen via een nieuw DataChannel-berichttype, renderen als overlay bovenop de video — geen enkele wijziging aan de video-pipeline zelf nodig).

---

## Bronnen (samengevat)

- [parsec.app](https://parsec.app/), [parsec.app/features](https://parsec.app/features)
- Parsec Support Center: [VDD](https://support.parsec.app/hc/en-us/articles/32381178803604-VDD-Overview-Prerequisites-and-Installation), [Privacy Mode](https://support.parsec.app/hc/en-us/articles/32361381211284-Privacy-Mode), [Hosting and Permissions](https://support.parsec.app/hc/en-us/articles/32381747079572-Hosting-and-Permissions), [Microphone passthrough](https://parsec.app/blog/now-available-microphone-passthrough)
- [splashtop.com/features](https://www.splashtop.com/features), [splashtop.com/compare/parsec-alternative](https://www.splashtop.com/compare/parsec-alternative)
- Splashtop Support Center: [Android gestures](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724403-Introduction-to-Android-gestures), [iOS gestures](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724363-Introduction-to-iOS-gestures-iPad-iPhone), [2FA setup](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/212724923-How-do-I-set-up-two-step-verification-2FA), [trusted devices](https://support-splashtopbusiness.splashtop.com/hc/en-us/articles/360054614071-How-to-manage-2FA-trusted-devices)
- [reemo.io](https://reemo.io/), [reemo.io/reemo-desktop](https://reemo.io/reemo-desktop/), [reemo.io/secure-remote-desktop](https://reemo.io/secure-remote-desktop/), [blog.reemo.io](https://blog.reemo.io/15-remote-desktop-software-options-from-free-to-premium-2025-guide/)
- BromeoRemote eigen broncode: `client/src/*`, `mobile/src/*`, `server/src/*`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/MOBILE.md`, `docs/47seconds.md`
