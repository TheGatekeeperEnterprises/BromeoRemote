# Marktonderzoek — Remote Desktop / Remote Support software

Onderzocht: **TeamViewer**, **AnyDesk**, **RustDesk** (open source), **Chrome Remote Desktop**, **Splashtop**.
Doel: alle relevante features in kaart brengen, zodat BromeoRemote minimaal gelijkwaardig is en op een aantal punten beter.

## 1. Featurematrix

| Feature | TeamViewer | AnyDesk | RustDesk | Chrome Remote Desktop | Splashtop | **BromeoRemote** |
|---|---|---|---|---|---|---|
| Snelle ondersteuning via ID + eenmalig wachtwoord | ✅ | ✅ | ✅ | ✅ (code) | ✅ | ✅ |
| Onbeheerde toegang (altijd aan, vast wachtwoord) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bestandsoverdracht (drag & drop, dubbelzijdig) | ✅ | ✅ | ✅ | ⚠️ beperkt | ✅ | ✅ |
| Klembord-synchronisatie (tekst + bestanden) | ✅ | ✅ | ✅ | ⚠️ beperkt | ✅ | ✅ |
| Chat tijdens sessie | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Sessie-opname (video) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Multi-monitor met schakelen tussen schermen | ✅ | ✅ | ✅ | ⚠️ beperkt | ✅ | ✅ |
| Wake-on-LAN | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Externe herstart + automatisch herverbinden | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Privacy / "black screen" op hostscherm tijdens sessie | ✅ | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| Two-factor authenticatie | ✅ | ✅ | ⚠️ (self-host) | ✅ (Google) | ✅ | ✅ |
| Rollen & rechten (view-only vs full control) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Adresboek / apparatenlijst met groepen | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| End-to-end encryptie (AES-256 / TLS) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Self-hosted server-optie (eigen infra) | ⚠️ (Tensor, duur) | ⚠️ (on-prem, duur) | ✅ (gratis, open source) | ❌ | ❌ | ✅ **eigen VPS, gratis** |
| Open source | ❌ | ❌ | ✅ (client), server deels | ❌ | ❌ | ✅ (jouw eigen code) |
| Mobiel: besturen vanaf telefoon/tablet | ✅ | ✅ | ✅ | ✅ | ✅ | 🔜 v3 (roadmap) |
| Mobiel apparaat als host (besturen) | ✅ | ✅ | ✅ | ⚠️ | ✅ | 🔜 v3 |
| Remote print | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ **bewust buiten scope** — vereist eigen virtuele printerdriver, bestandsoverdracht dekt het praktische geval |
| VPN / netwerkbrug tussen sites | ✅ | ✅ | ❌ | ❌ | ⚠️ | 🔜 v3 |
| Audit log / rapportage | ✅ (enterprise) | ✅ | ⚠️ | ❌ | ✅ | ✅ (basis: sessie-samenvatting + meldingengeschiedenis) |
| Automatische updates | ✅ | ✅ | ⚠️ (self-host) | n.v.t. (browser) | ✅ | ✅ **zelf gehost, geen abonnement** |
| AI-agent-notificatiebrug (bevestigen op afstand voor Antigravity/Claude Code/eigen scripts) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **uniek, geen concurrent biedt dit** |
| Prijsmodel | Duur, per-apparaat/licentie | Duur | Gratis (self-host) | Gratis | Abonnement | **Gratis, eigen infra, geen licentiekosten** |

## 2. Architectuurlessen uit RustDesk (belangrijkste open-source concurrent)

RustDesk gebruikt twee losse serverrollen — dit is het patroon dat we overnemen voor BromeoRemote:

- **hbbs (rendezvous/ID-server)**: houdt bij welk apparaat achter welk (dynamisch) IP-adres zit, matcht host + viewer op ID, probeert eerst een **directe P2P-verbinding** te leggen via UDP hole punching.
- **hbbr (relay-server)**: springt in zodra P2P niet lukt (bv. door symmetrische NAT/strenge firewall) en routeert het versleutelde verkeer 1-op-1 door.
- Verbindingen zijn **end-to-end versleuteld**; de relay-server kan de inhoud niet lezen, enkel bytes doorgeven.

BromeoRemote gebruikt hetzelfde tweetrapspatroon, maar bovenop **WebRTC**-standaarden (DTLS-SRTP encryptie, ingebouwde NAT-traversal) in plaats van een eigen protocol:

- **BromeoRemote Signaling Server** (eigen Node.js-service, te hosten op jouw VPS) = het equivalent van hbbs: apparaat-ID's, wachtwoordcontrole, en het uitwisselen van WebRTC session-descriptions/ICE-candidates.
- **TURN-relay** (coturn, industriestandaard open-source implementatie, te draaien naast de signaling server) = het equivalent van hbbr: valt terug op relay zodra directe P2P niet lukt.
- Het scherm- en besturingsverkeer zelf loopt via **WebRTC DataChannels + MediaStreams**, die standaard **DTLS/SRTP end-to-end versleuteld** zijn — dus zelfs jouw eigen relay-server ziet nooit de inhoud.

## 3. Extra suggesties (dingen die concurrenten niet goed doen, of die we kunnen verbeteren)

1. ~~Geen verplicht account voor snelle sessies~~ **Gebouwd** — net als TeamViewer/AnyDesk quick-support, maar zonder cloud-account-koppeling verplicht te maken voor eenmalige hulp.
2. ~~Eigen infrastructuur, geen abonnement~~ **Gebouwd** — omdat jij de signaling/relay-server zelf host, geen per-zitting- of per-apparaat-limieten zoals TeamViewer die oplegt aan gratis gebruikers. Geldt ook voor automatische updates: zelf gehost, geen licentie.
3. ~~Duidelijke, altijd-zichtbare "wie kan mij nu zien"-indicator~~ **Gebouwd** — een permanente statusbalk op het hostscherm tijdens een actieve sessie.
4. ~~Eén-klik "sessie direct beëindigen + wachtwoord wijzigen"-paniekknop~~ **Gebouwd** — extra beveiliging die geen van de onderzochte tools standaard zo expliciet aanbiedt.
5. ~~Bandbreedte-/kwaliteitsslider zichtbaar voor de kijker~~ **Gebouwd** (als transparante fps/kbps/latency-indicator, geen verborgen instelling).
6. ~~Ingebouwde sessie-samenvatting~~ **Gebouwd** — verschijnt automatisch bij het beëindigen van een sessie (duur, aantal overgezette bestanden).
7. ~~Curtain mode voor onbeheerde servers~~ **Gebouwd** (Windows: schakelt het fysieke scherm uit via `SC_MONITORPOWER`, schermdeling blijft doorlopen) — TeamViewer/AnyDesk hebben dit alleen in duurdere tiers.
8. **AI-agent-notificatiebrug** — een lokale API waarmee tools als Google Antigravity of Claude Code je op afstand om een bevestiging kunnen vragen (met gestructureerd commando + risiconiveau), inclusief doorsturen naar een ander apparaat. Geen enkele onderzochte concurrent biedt dit. Zie `docs/ANTIGRAVITY.md`.

## Bronnen

- [Wake-on-LAN – TeamViewer](https://www.teamviewer.com/en/solutions/use-cases/wake-on-lan/)
- [Remote desktop software—fast and secure – TeamViewer](https://www.teamviewer.com/en/solutions/use-cases/remote-desktop/)
- [Features – TeamViewer Remote](https://www.teamviewer.com/en-us/products/remote/features/)
- [Two-factor authentication for connections – TeamViewer](https://www.teamviewer.com/en-us/global/support/knowledge-base/teamviewer-classic/security/security-features/two-factor-authentication-for-connections/)
- [Mobile Device Management – TeamViewer](https://www.teamviewer.com/en/products/add-ons/mobile-device-management/)
- [RustDesk vs. AnyDesk – XDA Developers](https://www.xda-developers.com/rustdesk-vs-anydesk-which-free-teamviewer-alternative-better/)
- [Should you use TeamViewer, RustDesk, HelpWire, or AnyDesk? – XDA Developers](https://www.xda-developers.com/should-you-use-teamviewer-rustdesk-helpwire-or-anydesk/)
- [RustDesk Server Architecture – DeepWiki](https://deepwiki.com/rustdesk/rustdesk-server/2-architecture)
- [Rendezvous Server (hbbs) – DeepWiki](https://deepwiki.com/rustdesk/rustdesk-server/2.1-rendezvous-server-(hbbs))
- [Relay Server (hbbr) – DeepWiki](https://deepwiki.com/rustdesk/rustdesk-server/2.2-relay-server-(hbbr))
- [Self-host – RustDesk Documentation](https://rustdesk.com/docs/en/self-host/)
