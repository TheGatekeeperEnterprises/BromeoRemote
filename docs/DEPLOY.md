# BromeoRemote — Server deployen op je eigen VPS

Dit zet de twee serveronderdelen neer die apparaten wereldwijd met elkaar laten verbinden: de **signaling server** (dit project, `server/`) en **coturn** (bestaande, industriestandaard TURN-relay). Zonder deze twee werkt BromeoRemote alleen tussen apparaten op hetzelfde lokale netwerk.

## 1. Signaling server

Vereisten: een Linux-VPS met Node.js 20+ en een publiek IP-adres (of domeinnaam).

```bash
# Op de VPS
git clone <jouw-repo-of-kopieer-de-server-map>
cd server
npm install
npm run build
PORT=21116 npm start
```

Zet dit permanent aan met bijvoorbeeld `systemd`:

```ini
# /etc/systemd/system/bromeoremote-signaling.service
[Unit]
Description=BromeoRemote signaling server
After=network.target

[Service]
WorkingDirectory=/opt/bromeoremote/server
ExecStart=/usr/bin/node dist/index.js
Environment=PORT=21116
Restart=always
User=bromeoremote

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now bromeoremote-signaling
```

**Belangrijk — zet TLS ervoor.** Zet een reverse proxy (nginx/Caddy) met een Let's Encrypt-certificaat voor de WebSocket-server, zodat clients verbinden via `wss://jouw-domein.nl` in plaats van onversleuteld `ws://`. Anders is het wachtwoord-hashverkeer tussen client en server niet beschermd tijdens transport.

Voorbeeld (Caddy, automatisch HTTPS):

```
remote.jouwdomein.nl {
  reverse_proxy localhost:21116
}
```

## 2. TURN-relay (coturn)

Nodig voor verbindingen die niet direct P2P kunnen (bedrijfsnetwerken, strikte firewalls, symmetrische NAT). We gebruiken **coturn** — niet zelf herbouwen, dat is precies waar dit project (RFC 5766, al 10+ jaar in productie bij o.a. WhatsApp, Discord) voor bedoeld is.

**Als je Coolify gebruikt** (zoals deze deployment): `coturn/` in de repo-root bevat een kant-en-klare `docker-compose.yml` + `turnserver.conf`. Maak een nieuwe resource aan met build pack "Docker Compose", base directory `/coturn`. Belangrijk: dit draait met `network_mode: host` omdat TURN losse UDP-poorten nodig heeft die niet via Traefik/HTTPS te routeren zijn — de `turn.jouwdomein.nl`-domeinnaam hoeft dus niet als Coolify-domein aan deze resource gekoppeld te worden, DNS hoeft alleen naar hetzelfde publieke IP te wijzen. Open in je router/firewall: **3478/udp+tcp** en de relay-poortrange uit `turnserver.conf` (**49152-49252/udp** by default) naar het interne IP van de Coolify-host.

Zonder Coolify, handmatig op een kale VPS:

```bash
sudo apt install coturn

# /etc/turnserver.conf
listening-port=3478
tls-listening-port=5349
realm=jouwdomein.nl
fingerprint
lt-cred-mech
user=bromeo:kies-een-sterk-wachtwoord
cert=/etc/letsencrypt/live/jouwdomein.nl/fullchain.pem
pkey=/etc/letsencrypt/live/jouwdomein.nl/privkey.pem
no-cli
```

```bash
sudo systemctl enable --now coturn
```

Open in je VPS-firewall/security group: **3478/udp+tcp**, **5349/udp+tcp** (TLS), en een UDP-relay-poortrange (bv. 49152-65535/udp).

## 3. Client configureren

In `client/src/shared/config.ts`:

```ts
export const DEFAULT_SIGNALING_URL = "wss://remote.jouwdomein.nl";

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "turn:jouwdomein.nl:3478", username: "bromeo", credential: "kies-een-sterk-wachtwoord" },
];
```

Of zet `BROMEO_SIGNALING_URL` als omgevingsvariabele bij het bouwen van de app, zodat je geen productiegegevens hardcodet in de broncode.

## 4. Testen

```bash
curl https://remote.jouwdomein.nl/health
# {"status":"ok","online":0}
```

Start de BromeoRemote-app op twee verschillende netwerken (bv. je pc + je telefoon met hotspot) en verbind via ID + wachtwoord — als het via je eigen wifi al werkte maar nu niet, controleer dan of de coturn-poorten echt open staan.

## 5. Automatische updates hosten

BromeoRemote gebruikt `electron-updater` om zichzelf bij te werken. Dat heeft alleen een plek nodig waar het de laatste installer + een `latest.yml`-metadatabestand kan vinden — geen database of server-logica, gewoon statische bestanden.

**Stap 1 — bouw een release:**
```bash
cd client
npm run dist
```
Dit produceert in `client/release/`:
- `BromeoRemote-Installer.exe` + `.blockmap` — de NSIS-installer, dit is wat gebruikers installeren en wat auto-update gebruikt
- `BromeoRemote-Setup.exe` — de portable variant (geen auto-update, voor snel testen zonder installatie)
- `latest.yml` — metadata die de geïnstalleerde app leest om te checken of er een nieuwere versie is

**Stap 2 — zet `BromeoRemote-Installer.exe`, `.blockmap` en `latest.yml` op je VPS**, bereikbaar over HTTPS, bijvoorbeeld via dezelfde Caddy die je al voor de signaling server gebruikt:
```
updates.jouwdomein.nl {
  root * /var/www/bromeoremote-updates
  file_server
}
```
```bash
scp client/release/BromeoRemote-Installer.exe client/release/BromeoRemote-Installer.exe.blockmap client/release/latest.yml \
  gebruiker@jouw-vps:/var/www/bromeoremote-updates/
```

**Stap 3 — wijs de app naar die URL** in `client/package.json` (`build.publish.url`):
```json
"publish": { "provider": "generic", "url": "https://updates.jouwdomein.nl/" }
```

**Bij elke nieuwe versie:** verhoog `version` in `client/package.json` (bv. via `npm version patch`), bouw opnieuw (`npm run dist`), en overschrijf de drie bestanden op de VPS. Geïnstalleerde apps controleren automatisch bij het opstarten (of via de knop "Controleer op updates" onderaan het venster) en downloaden/installeren de nieuwe versie zodra die er staat.

De portable exe (`BromeoRemote-Setup.exe`) controleert bewust **niet** op updates — die heeft geen vaste installatielocatie om zichzelf te vervangen, dus blijft altijd de versie die je er zelf van hebt gedownload.
