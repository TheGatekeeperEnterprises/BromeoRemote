# BromeoRemote Mobile (Android) — vanaf je telefoon een pc bekijken/besturen

`mobile/` is een React Native-app waarmee je vanaf je telefoon verbindt met een pc die BromeoRemote draait (`client/`) — zelfde ID + wachtwoord-systeem, zelfde signaling server. De telefoon kan **zowel** een andere pc bekijken/besturen **als** zelf als host optreden (een pc bekijkt/bedient dan de telefoon, zie §4). Android-only in deze versie — iOS heeft een macOS-machine met Xcode nodig, die er bij het bouwen van deze app niet was.

## Functies

- Verbinden via BromeoRemote-ID + wachtwoord (zelfde als de desktop-app), of één-tik verbinden met een **opgeslagen apparaat**: "Dit apparaat onthouden" bij het verbinden slaat het (al gehashte — het wachtwoord zelf komt nooit los over de lijn of in opslag terecht) sessiewachtwoord lokaal op (`AsyncStorage`), met een eigen naam, favorieten (⭐, altijd bovenaan) en verwijderen. Geen groepen of Wake-on-LAN in deze versie (WoL vanaf mobiel data heeft weinig zin — werkt toch alleen op hetzelfde lokale netwerk als het slapende apparaat).
- Live videoweergave van het gedeelde scherm, **inclusief systeemgeluid** van de host (Electron's loopback-audiocapture, zelfde pad als de desktop-viewer)
- Twee besturingsmodi tijdens een sessie, met een 👆/🖱️-schakelaar in de sessiebalk — beide gemodelleerd naar TeamViewer's eigen "Interactiemethode"-schermen, gesture voor gesture:
  - **Tik-modus** (standaard): tik = klik op die absolute plek, lang indrukken (>500ms, zonder bewegen) = rechtsklik op die plek, **één vinger meteen slepen** (vóór de lang-indrukken-drempel) = scrollen (stuurt scroll-wheel-invoer naar de host, raakt de cursor niet aan), **lang indrukken en dán pas slepen** = klikken-en-slepen vanaf het punt waar je begon (bv. tekst selecteren) — dezelfde vinger disambigueert dus drie dingen puur op timing/beweging, zonder dat je vooraf hoeft te kiezen.
  - **Muis-modus** (trackpad-stijl): een zichtbare cursor-stip op het beeld die je relatief verplaatst door te slepen (net als een laptop-trackpad, niet absoluut tikken-op-een-plek) — tik = klik, lang indrukken = rechtsklik, **dubbeltik en op de tweede tik meteen doorslepen** = klikken-en-slepen (bv. tekst selecteren) — een gewone, langzame sleepbeweging activeert dit nooit, hoe lang hij ook duurt.
  - Beide modi: **twee vingers slepen = schuiven** (pant het lokaal ingezoomde beeld — raakt de sessie zelf niet aan, en heeft dus geen effect zolang je niet ingezoomd bent). Knijpen (twee vingers, afstand verandert) = inzoomen op het beeld, alleen visueel — muisklikken/cursorpositie blijven nauwkeurig op de juiste plek terechtkomen, ook terwijl je ingezoomd bent. Dubbeltikken = inzoomen op dat punt (2,5x), of weer uitzoomen als je al ingezoomd was.
  - *Zoom zelf blijft een client-side visuele vergroting van het al ontvangen beeld — het vraagt niet om een scherpere bronopname, dus compressie-artefacten worden vergroot mee-uitgezoomd. De host's video-encoder is wel ingesteld op `degradationPreference: "maintain-resolution"`, zodat bij weinig bandbreedte liever de framerate zakt dan de resolutie — leesbaarheid van tekst weegt zwaarder dan vloeiendheid bij schermdelen.*
- On-screen toetsenbord-brug (tekstinvoer, Enter, Backspace)
- Chat tijdens een sessie (💬 in de sessiebalk, met een rode stip bij nieuwe berichten terwijl het paneel dicht is) — hergebruikt het bestaande datakanaal dat de sessielaag (`MobileSession`) al had; dit was puur een ontbrekende UI, geen nieuw protocol. Alleen voor de viewer-rol in deze versie, niet wanneer de telefoon zelf host is.
- Bestandsoverdracht tijdens een sessie (📁 in de sessiebalk): bestand versturen via de systeem-bestandskiezer (`@react-native-documents/picker`) en ontvangen bestanden komen terecht in de Downloads-map (`react-native-blob-util`, incl. media-scan zodat het bestand direct zichtbaar is in andere apps) — zelfde `FileMessage`-protocol en chunking (48KB per stuk, back-pressure op `bufferedAmount`) als de desktop-app. Geen accepteren/weigeren per bestand: de sessie zelf is al de toestemmingsgrens, zelfde gedrag als desktop. Voortgangsbalk per overdracht, zowel versturen als ontvangen. Alleen voor de viewer-rol in deze versie.
- Multi-monitor wisselen vanuit Sessie-instellingen zodra de host 2+ schermen meldt (zelfde `monitor-list`/`switch-monitor`-berichten als desktop).
- Automatisch opnieuw verbinden na een herstart-verzoek: probeert elke 15s tot ~5 minuten opnieuw te verbinden met hetzelfde apparaat, zelfde gedrag/timing als de desktop-viewer.
- Tweestapsverificatie (TOTP) bij het verbinden met een host die dat vereist: een los invoerscherm voor de 6-cijferige code verschijnt automatisch (herkent zowel "code nodig" als "foute code, probeer opnieuw").
- Sessie-samenvatting als toast zodra een sessie eindigt ("Sessie beëindigd — duurde 3 min 12s, 2 bestand(en) overgezet."), zelfde tekst als desktop's samenvatting — zonder desktop's opgeslagen sessiegeschiedenis/notities, dat is (nog) niet gebouwd voor mobiel.
- Icoon-gebaseerde sessiebalk **onderaan het scherm** (TeamViewer-stijl): naast de 👆/🖱️-schakelaar een **Snelle acties**-paneel (⚡: computer vergrendelen, computer op afstand herstarten, externe gebruikersinvoer blokkeren — allemaal door de host afgedwongen en verborgen bij een alleen-kijken-sessie), een **Snelkoppelingen**-paneel (⌥: Kopiëren/Plakken/Schermafbeelding/Alt+Tab/Opslaan) en een instellingenscherm (⚙️: kwaliteit — Automatisch/Hoog/Laag, begrenst de host's uitgaande videobitrate — en "Externe cursor tonen" om de muis-modus-cursorstip te verbergen). De hele balk is inklapbaar (﹀) tot een klein knopje (︿) voor meer beeldruimte. Apparaat-ID en verbindingsstatistieken staan in een eigen, altijd zichtbare balk bovenaan.
  *Stond aanvankelijk bovenaan, maar op een echt toestel bleken de knoppen daar soms niet te reageren op tikken: `SafeAreaView` kwam uit `react-native` zelf, wat op Android in de praktijk een no-op is (vrijwel iOS-only) — zonder correcte inzet voor de statusbalk/notch kon de bovenbalk deels onder het systeem-UI terechtkomen. Nu vervangen door `react-native-safe-area-context`'s versie (was al een afhankelijkheid, alleen nooit met een `SafeAreaProvider` gebruikt) mét de balk zelf naar onderaan verplaatst — lost de kernoorzaak op én matcht TeamViewer's layout.*
- Agent-meldingen ontvangen en bevestigen (zie `docs/ANTIGRAVITY.md`) — **ook tijdens een actieve sessie**: je kunt een pc besturen en tegelijk een bevestigingsverzoek van een andere pc afhandelen, zonder de sessie te verlaten
- Je eigen BromeoRemote-ID staat altijd zichtbaar op het beginscherm, zodat je 'm kunt invullen bij "Meldingen doorsturen naar" op de pc waar je op afstand bij bent
- Draai je telefoon horizontaal tijdens een sessie om het pc-scherm liggend te zien — een pc-scherm is meestal 16:9, dus liggend gebruikt dat de telefoonschermruimte veel beter dan staand. Draait automatisch mee (geen aparte instelling nodig), touch-besturing blijft correct werken in beide standen.
- **Echte pushmeldingen (FCM)**: agent-bevestigingen komen ook aan als de app dicht staat of op de achtergrond draait — niet alleen zolang de app open is. Vereist je eigen Firebase-project, zie §5 hieronder; zonder dat blijft alles gewoon werken zolang de app open is (de bestaande WebSocket-meldingen), push is puur een aanvulling.
- Eigen branding: het echte BromeoRemote-app-icoon (`icon.png`) op alle schermdichtheden, een donker opstartscherm met het logo (native, direct zichtbaar bij het opstarten — geen witte flits) dat overloopt in een bijpassend "Verbinden…"-laadscherm in de app zelf zodra de JS-kant overneemt.

## 1. Bouwen en draaien

Vereisten: Android Studio (SDK + platform-tools), een JDK 17 (Gradle/AGP hebben hier problemen mee bij nieuwere JDK's — zet `JAVA_HOME` expliciet op een JDK 17-install), en de NDK-versie die `mobile/android/build.gradle` verwacht.

```bash
cd mobile
npm install
```

**Metro (JS-bundler) starten:**

```bash
npx react-native start
```

**Op een emulator of aangesloten toestel installeren:** als `npx react-native run-android` in jouw omgeving vastloopt op een `gradlew.bat`-spawnfout (een bekende eigenaardigheid op sommige Windows-installaties, geen fout in dit project), bouw en installeer dan handmatig:

```bash
cd android
./gradlew assembleDebug          # of gradlew.bat op Windows
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.bromeoremotemobile/.MainActivity
```

Zorg dat `JAVA_HOME` en `ANDROID_HOME`/`ANDROID_SDK_ROOT` gezet zijn voordat je Gradle aanroept.

**Een installeerbare .apk bouwen (geen Metro nodig, testen op je eigen telefoon):**

```bash
cd android
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Dit bundelt de JS erin (geen dev-server nodig) en gebruikt hetzelfde debug-keystore als de debug-build (React Native's standaardgedrag — voldoende om zelf te installeren en testen, niet voor de Play Store). Een kant-en-klare build staat ook in `mobile/release/BromeoRemoteMobile.apk`.

> **Windows + een diep geneste projectmap (`MAX_PATH`/260 tekens):** als `assembleRelease` faalt op een `ninja`/CMake-fout over een te lang pad, komt dat door Windows' klassieke 260-tekenlimiet — CMake/ninja's eigen padcontrole respecteert de `LongPathsEnabled`-registry-instelling niet, dus die lost het niet op. De enige betrouwbare fix is een kort pad: houd de projectmap zelf kort (bv. `D:\BromeoRemote`, niet genest onder meerdere lange mapnamen) — dit project is om precies die reden verplaatst. Een junction naar een korte naam kan als tussenoplossing werken (`cmd /c mklink /J D:\br-mobile "<pad>\mobile"`), maar **moet op dezelfde schijfletter staan** als het echte pad, anders faalt de JS-bundlingstap op een "different roots"-fout.

> **Cleartext (`ws://`) op een release-build:** Android blokkeert standaard onversleuteld verkeer voor release-builds (API 28+) — alleen debug-builds staan dit universeel toe. `mobile/android/app/src/main/res/xml/network_security_config.xml` bevat daarom een uitzondering voor `192.168.1.128` en `10.0.2.2` (de adressen die tijdens ontwikkeling zijn gebruikt). **Pas dit bestand aan naar het IP van jouw eigen signaling server** als je een release-apk bouwt voor een ander netwerk — of gebruik `wss://` in productie (`docs/DEPLOY.md`), dan is deze uitzondering niet nodig.

## 2. Signaling-server bereikbaar maken

`mobile/src/shared/config.ts` bepaalt waar de app de signaling server zoekt:

- **Emulator**: `ws://10.0.2.2:21116` (standaard) — `10.0.2.2` is de emulator's eigen alias voor "de hostmachine", niet je echte netwerk-IP.
- **Echt toestel op hetzelfde wifi-netwerk als je signaling server**: vervang door het LAN-IP van die machine, bv. `ws://192.168.1.50:21116`.
- **Productie**: je eigen `wss://`-domein, zie `docs/DEPLOY.md`.

## 3. TURN-relay

`DEFAULT_ICE_SERVERS` in datzelfde bestand bevat standaard alleen een publieke STUN-server — voldoende zolang telefoon en pc elkaar direct kunnen bereiken (zelfde wifi, of een router die dat toelaat). Voor verbindingen over het echte internet, of wanneer een van beide achter een strikte/symmetrische NAT zit, heb je **dezelfde coturn-relay nodig als de desktop-app** — voeg het `turn:`-item toe zoals beschreven in `docs/DEPLOY.md` §2, in **beide** config-bestanden (`client/src/shared/config.ts` én `mobile/src/shared/config.ts`).

## 4. Telefoon als host (een pc bekijkt/bedient deze telefoon)

Op het beginscherm staat een rotatiewachtwoord (verandert bij elke herstart, net als de desktop-app) — geef je BromeoRemote-ID + dat wachtwoord door aan iemand op een pc, en verbind vanaf de desktop-app zoals je met een andere pc zou doen. Je krijgt een toestemmingsdialoog (Toestaan/Weigeren) voordat er iets gedeeld wordt.

**Schermdelen** gebruikt Android's ingebouwde MediaProjection-API (via `react-native-webrtc`'s `getDisplayMedia()`) — geen eigen native code nodig, maar Android toont bij elke sessie **zelf ook nog** een systeemdialoog ("Start recording or casting?") die je op het toestel zelf moet bevestigen. Dat is Android's eigen beveiliging, niet iets wat BromeoRemote kan overslaan.

**Bediening op afstand** (tikken/vegen simuleren vanaf de pc) vereist een aparte, native `RemoteControlAccessibilityService` (`mobile/android/app/src/main/java/com/bromeoremotemobile/`) — een normale app kan sowieso geen aanraking in andere apps injecteren; Android's Accessibility-gebarendispatch is het enige niet-root-mechanisme hiervoor (zelfde aanpak als TeamViewer QuickSupport/AirDroid). Moet **handmatig** ingeschakeld worden via Instellingen → Toegankelijkheid — de kaart "Bediening op afstand" op het beginscherm laat de instellingen direct openen en toont de actuele status. Zonder dit werkt schermdelen gewoon, maar kan de pc alleen kijken, niet bedienen.

Muis-/toetsenbordevents worden vertaald (`mobile/src/inputTranslator.ts`): een sleepbeweging (mousedown→mousemove*→mouseup) wordt gebufferd tot één volledig gebarenpad en pas bij mouseup gedispatcht — Android's `dispatchGesture()` verwacht het hele pad in één keer, in tegenstelling tot een losse muis die punt voor punt beweegt. Toetsenbordinvoer (tekst/toetsen) wordt **niet** ondersteund in v1 — dat vereist het lokaliseren van het actief geselecteerde tekstveld en `ACTION_SET_TEXT`, een wezenlijk ander mechanisme dan gebaren-dispatch.

> **Nog niet geverifieerd op een echt toestel:** op de ontwikkel-emulator (Android Studio AVD) werkt de hele pijplijn tot en met een succesvolle WebRTC-verbinding en een actieve, correct geconfigureerde video-encoder — maar er komen structureel 0 frames uit de encoder (`framesEncoded: 0` in `getStats()`, ook na een volledige herstart van de emulator). Dat wijst op een bekende categorie beperkingen van MediaProjection/VirtualDisplay-schermopname op sommige Android-emulatorbeelden, niet op een fout in deze code — alle andere stappen (toestemmingsdialogen, WebRTC-onderhandeling, databaan, accessibility-service) zijn wél bevestigd te werken. Test op een echt Android-toestel om dit definitief te bevestigen.

## 5. Echte pushmeldingen instellen (Firebase Cloud Messaging)

Zonder dit werken meldingen prima zolang de app open/actief is (via de bestaande WebSocket) — dit is puur nodig om ze ook aan te laten komen als de app dicht staat of op de achtergrond draait. Er staat een **placeholder** `google-services.json` in de repo zodat het project meteen bouwt; die moet je vervangen door je eigen Firebase-project voordat push echt werkt.

**1. Firebase-project + Android-app aanmaken** (gratis, geen creditcard nodig voor Cloud Messaging):
1. Ga naar [Firebase console](https://console.firebase.google.com/), maak een nieuw project.
2. Voeg een Android-app toe met pakketnaam **`com.bromeoremotemobile`** (moet exact overeenkomen — dit staat in `mobile/android/app/build.gradle` als `applicationId`).
3. Download het gegenereerde `google-services.json` en vervang `mobile/android/app/google-services.json` ermee.

**2. Service-account key voor de signaling server** (dit is wat de server gebruikt om daadwerkelijk een push te *versturen*):
1. In de Firebase console: Project instellingen → Service accounts → "Genereer nieuwe privésleutel". Dit downloadt een JSON-bestand.
2. Zet die sleutel op de server op **een van deze twee manieren**:
   - **`FIREBASE_SERVICE_ACCOUNT_JSON`** (aanbevolen voor Coolify/containers): plak de *inhoud* van het gedownloade bestand rechtstreeks als omgevingsvariabele — of, als het platform problemen geeft met meerdere regels/aanhalingstekens in één env-var, base64 het bestand eerst (`base64 -w0 serviceAccountKey.json`) en plak dát in plaats daarvan; beide vormen werken. Geen bestand, geen persistent volume nodig — alleen een env var in Coolify's UI.
   - **`FIREBASE_SERVICE_ACCOUNT_PATH`** (voor een normale server zonder containers): zet het bestand ergens veilig op de machine (**niet in de git-repo**) en verwijs ernaar met het volledige pad.
   ```bash
   # Optie A (env var, geen bestand nodig)
   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account", ...}' npm start
   # Optie B (bestand op schijf)
   FIREBASE_SERVICE_ACCOUNT_PATH=/pad/naar/serviceAccountKey.json npm start
   ```
   Zonder een van beide blijft de server gewoon werken (WebSocket-meldingen ongewijzigd) — hij logt alleen eenmalig dat push uitstaat. Wordt er ooit gemeld dat pushmeldingen niet aankomen terwijl de telefoon-app dicht/op de achtergrond stond: dit is de eerste plek om te controleren — check of de env var daadwerkelijk op de *daadwerkelijk draaiende* server-instantie staat, niet alleen dat het sleutelbestand ergens lokaal gedownload is.
3. **Optioneel maar aanbevolen**: zet ook `PUSH_TOKENS_PATH` (bv. `/data/push-tokens.json`, gemount als persistent volume in Coolify) zodat geregistreerde FCM-tokens een gewone procesherstart overleven — zonder deze variabele valt de server terug op `./data/push-tokens.json` relatief aan waar het proces draait, wat een volledige container-redeploy (in tegenstelling tot alleen een proces-crash/herstart) nog steeds wist tenzij dat pad zelf al op een persistent volume staat.

**3. Mobiele app opnieuw bouwen** met het echte `google-services.json` erin (zie §1 hierboven, `assembleDebug`/`assembleRelease`).

Daarna: bij het opstarten vraagt de app om meldingstoestemming (Android 13+), haalt een FCM-token op en registreert dat bij de signaling server. De server stuurt bij elke `/confirm`-melding (zie `docs/ANTIGRAVITY.md`) zowel de bestaande WebSocket-melding als een FCM-push — welke van de twee het apparaat het eerst bereikt hangt af van of de app op dat moment actief is.

## Bekende beperkingen (v1)

- **Telefoon-als-host nog niet geverifieerd met echte videoframes** — zie de opmerking in §4; werkt tot en met een actieve WebRTC-verbinding, frames zelf nog niet bevestigd (vermoedelijk emulatorbeperking, geen toestel voorhanden om dit te bevestigen).
- **Geen toetsenbordinvoer bij telefoon-als-host** — alleen tikken/vegen/lang-indrukken, zie §4.
- **Android-only** — geen iOS-build (macOS/Xcode ontbrak op de ontwikkelmachine).
- **Apparaat-ID wordt lokaal gegenereerd en opgeslagen** (`AsyncStorage`), net als bij de desktop-app — geen account nodig.
- **Pushmeldingen vereisen je eigen Firebase-project** (§5) — zonder dat werken meldingen alleen zolang de app open is, wat voor v1 zonder Firebase-setup de standaardsituatie is (er staat een niet-functionele placeholder-config in de repo).
