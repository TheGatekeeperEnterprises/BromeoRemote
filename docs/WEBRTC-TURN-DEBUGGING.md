# WebRTC/TURN production debugging log — 2026-07-22/23

This documents the migration from LAN-only testing to a production Coolify
deployment, and the extended debugging session that followed. Written so a
future investigation (by a human or an AI assistant) doesn't have to
rediscover any of this from scratch.

## 1. What got deployed

Three new Coolify resources were added alongside the existing website
resource, all in the same GitHub repo/branch (`main`), differentiated by
**Base Directory**:

| Resource | Base Directory | Build pack | Domain | Purpose |
|---|---|---|---|---|
| BromeoRemote Server | `/server` | Dockerfile | `remote.bromeoremote.com` | Signaling (WebSocket) |
| BromeoRemote TURN | `/coturn` | Docker Compose | *(none — see below)* | TURN relay (coturn) |
| BromeoRemote website | `/` | Dockerfile | `bromeoremote.com` | Pre-existing, unrelated |

- `server/Dockerfile` — standard multi-stage Node build, listens on `21116`.
- `coturn/docker-compose.yml` + `coturn/turnserver.conf` — coturn deployed
  with `network_mode: host` (required: TURN needs raw UDP relay ports,
  which Coolify's Traefik/HTTPS routing can't proxy). No Coolify "Domain" is
  assigned to this resource — DNS points straight at the host's IP instead
  (see below), bypassing Traefik entirely.
- Both `client/src/shared/config.ts` and `mobile/src/shared/config.ts` point
  at `wss://remote.bromeoremote.com` (signaling) and
  `turn:turn.bromeoremote.com:3478` (TURN, both UDP and
  `?transport=tcp` variants offered — see §4).

**Infrastructure**: self-hosted at the user's home, behind an **OPNsense**
firewall/router. The Coolify host itself sits on the LAN at `192.168.1.20`;
public traffic reaches it via port-forwarding through OPNsense.

**DNS** (Hostinger): `remote`, `turn`, `updates` are all A/CNAME records
pointing at the same public IP as the root domain.

**Router port-forwards** (OPNsense, Firewall → NAT → Port Forward, on the
`Delta_vlan107` WAN interface):
- UDP 3478 → `192.168.1.20:3478`
- TCP 3478 → `192.168.1.20:3478`
- UDP 49152–49252 → `192.168.1.20:49152-49252` (coturn's relay port range)

## 2. Bugs found and fixed along the way

These are all real, confirmed bugs — independent of the big TURN mystery in
§4 below.

### 2.1 `registry.ts` — stale ID squatting
`DeviceRegistry.register()` used to silently hand out a random ID whenever
the requested ID was already taken — including by a *dead* socket (e.g. from
a force-killed app instance; there's no ping/pong heartbeat, so the server
has no fast way to notice a socket is gone). Fixed: a device reconnecting
with its own persisted ID now always reclaims it, closing out whatever stale
socket was squatting on it first. (`server/src/registry.ts`)

### 2.2 Signaling server had zero logging
Added `console.log` for `hello` / `connect-request` / `connect-response` /
`signal` / `close` in `server/src/index.ts`. Previously the server logged
nothing past its startup line, making it impossible to tell whether a
connection attempt even reached it. This logging is cheap and worth keeping
permanently.

### 2.3 TURN-over-TCP fallback
Mobile carrier CGNAT frequently reassigns NAT mappings mid-flow for
long-lived UDP, which can break TURN allocation before it ever completes.
Both `DEFAULT_ICE_SERVERS` configs now offer the TURN server over **both**
UDP and TCP (`turn:host:3478` and `turn:host:3478?transport=tcp`); coturn
was never configured with `no-tcp`, so this needed no server-side change.

### 2.4 Split-DNS override for the LAN
Added an OPNsense **Unbound DNS → Host Override** so `remote.` and `turn.`
resolve directly to `192.168.1.20` for anything on the home LAN, avoiding a
NAT hairpin round-trip through the router. **This turned out not to matter
for the actual bug** (see §4) but is still correct/worth keeping — it's a
strict improvement (lower latency, one less thing to go wrong) for any LAN
client, and doesn't affect remote clients at all.

## 3. The ~40-second mid-session drop (partially unresolved — see §5)

**Symptom**: a session would connect successfully, then die at almost
exactly 40 seconds, cleanly (no error), from *both* sides.

**Original diagnosis** (turned out to be probably wrong — see §5): coturn
logs showed both peers' TURN allocations being explicitly released
(`Refresh lifetime=0`, a deliberate teardown, not a timeout) at the same
instant the session died. The theory was that ICE started the connection on
a working TURN relay candidate, then kept probing in the background for a
"better" direct P2P candidate pair, switched to it once it passed a
connectivity check, and tore down the still-working relay allocation in the
process — but the "better" pair didn't actually hold up (plausible in a
topology where one peer shares a LAN with the coturn box), so the whole
session died once the working path was gone.

**Fix applied at the time**: `iceTransportPolicy: "relay"` on both desktop
and mobile, forcing ICE to only ever use relay candidates, never switching
to a direct pair. **This was later reverted on desktop** (kept on mobile) —
see §5's conclusion.

## 4. THE major investigation: desktop TURN allocate always fails

After forcing `iceTransportPolicy: "relay"`, **every single connection
attempt from the desktop app failed outright** (previously it had at least
connected for ~40s). Extensive debugging followed. Full list of things
investigated and **ruled out**, in order:

1. ❌ Coolify TURN resource not deployed / misconfigured — ruled out: coturn
   logs consistently showed `ALLOCATE processed, success` server-side.
2. ❌ Router NAT/firewall UDP state timeouts (OPNsense `pf` "Firewall
   Optimization" mode) — switched `normal` → `conservative`, no change.
3. ❌ Linux conntrack timeouts on the Coolify host — never got a chance to
   properly test this before finding the real cause, but made moot by §4.9.
4. ❌ ICE switching from relay to a broken direct candidate — the *coturn
   Refresh(lifetime=0)* observation was real, but turned out to be a
   downstream symptom of clients retrying, not a mid-session renegotiation.
5. ❌ A retry-loop bug in the app code — added `console.trace()` at the
   mobile `connectTo()` call site; confirmed a single tap really does call
   it exactly once. The "many connect-request bursts" seen in earlier
   signaling logs were just the user manually re-tapping "Connect" out of
   frustration (the UI gives no "connecting…" feedback that would
   discourage that) — not a code bug.
6. ❌ Stale/duplicate desktop app processes — checked, only one clean set of
   Electron helper processes at any time.
7. ❌ Running an outdated build — this **did** happen at least twice during
   the session (testing `BromeoRemote-Setup.exe` from a stale
   `client/release/` while a newer `dist/` existed) and cost real time; a
   full `rm -rf dist release && npm run dist` clean rebuild plus verifying
   `grep`-for-marker-string in the built output was the fix each time. If a
   fix "doesn't seem to do anything," verify the running binary actually
   contains it before concluding the fix failed.
8. ❌ NAT hairpin through the router for LAN-local desktop traffic — the
   split-DNS override (§2.4) was added specifically to eliminate this,
   confirmed via `Resolve-DnsName` returning the LAN IP correctly — no
   change in behavior.
9. ❌ Chromium's Secure DNS (DNS-over-HTTPS) bypassing the OS/router
   resolver and re-introducing the hairpin — disabled via
   `app.commandLine.appendSwitch("disable-features", "DnsOverHttps")` in
   `client/src/main/main.ts` (**kept**, harmless and arguably correct
   regardless) — no change in behavior.
10. ❌ CSP blocking `stun:`/`turn:` — `index.html`'s
    `Content-Security-Policy` `connect-src` really was missing `stun:
    turn:` (Chromium *does* enforce CSP against RTCPeerConnection's ICE
    server URLs, not just fetch/WebSocket) — fixed (**kept**, this was a
    real, separate bug worth having fixed) — but no change in the TURN
    failure specifically; the "701" errors we were chasing didn't have the
    signature of a CSP block (a real block is instant, not a timeout) and
    this was confirmed by ruling out further down the list.
11. ❌ Windows Firewall rules — checked `Get-NetFirewallRule`, zero explicit
    or implicit blocks for the app.
12. ❌ Third-party antivirus/firewall — `Get-CimInstance
    -Namespace root/SecurityCenter2` showed only Windows Defender
    registered, nothing else installed.
13. ❌ System-wide HTTP/SOCKS proxy — `ProxyEnable = 0`, none configured.
14. ❌ Dead/stale network adapters (Docker Desktop's engine wasn't even
    running, but its virtual adapter still existed) confusing candidate
    gathering — a full PC restart cleared this specific noise (some earlier
    errors like "Address not associated with the desired network interface"
    stopped appearing) but the core TURN failure remained.
15. ❌ Windows Defender Network Protection (deep packet inspection) —
    `Get-MpPreference` showed `EnableNetworkProtection = 0` (disabled).
16. ❌ Third-party VPN/security network filter drivers —
    `Get-NetAdapterBinding` showed only stock Microsoft components bound to
    the adapter.
17. ❌ Corrupted Chromium network/cache state in the app's own userData
    folder — cleared `Network/`, `Cache/`, `GPUCache/` under
    `%APPDATA%\BromeoRemote`, no change.
18. ❌ `iceTransportPolicy: "relay"` itself — reverted temporarily to
    default policy on desktop, **still failed identically**. This
    definitively separated "the relay-only setting" from "TURN allocate
    doesn't work" as two independent things.
19. ❌ Same-LAN-specific (hairpin/topology) issue — tested with the PC moved
    onto a phone hotspot (genuinely different public IP, confirmed via
    `api.ipify.org` before/after), completely different network path from
    coturn. **Still failed identically.** This ruled out the entire
    same-LAN/hairpin branch of investigation.
20. ❌ Electron-specific bug (vs. Chromium generally) — tested via plain
    **Microsoft Edge** (unrelated installation, not Electron) hitting the
    same TURN server from DevTools console. **Failed identically.** Proved
    this has nothing to do with Electron/our app packaging at all — it's
    Chromium's own network stack on this machine.
21. ❌ coturn's `fingerprint` config directive (RFC 5389 §8 FINGERPRINT
    attribute) causing an overly-strict Chromium response validation to
    silently reject valid responses — removed `fingerprint` from
    `coturn/turnserver.conf`, redeployed, retested. **No change.**
22. ❌ Our TURN server/config specifically — tested against
    **openrelay.metered.ca**, a well-known public/free TURN test server
    completely unrelated to our infrastructure, using its published test
    credentials (`openrelayproject`/`openrelayproject`). **Failed
    identically** ("STUN binding request timed out" / "TURN allocate
    request timed out"). This is the conclusive result: it's not our
    server, not our config, not anything in this project at all.

### The one genuinely deep finding

A **Chromium NetLog capture** (`--log-net-log=path.json`, then parsed for
`UDP_SOCKET` events) showed something remarkable: at the raw socket level,
Chromium's UDP socket to the TURN server was **genuinely sending requests
and receiving real responses** — e.g.
`UDP_BYTES_SENT ... 28 bytes` immediately followed by
`UDP_BYTES_RECEIVED ... 92 bytes` / `76 bytes` (sizes matching real
STUN/TURN response packets, confirmed against a hand-crafted raw STUN test
via Node.js that got the identical byte counts). This happened on **two
separate sockets** (plain IPv4 to the server's public IP, and a
NAT64-synthesized IPv6 address — the mobile hotspot network is
IPv6-only-with-NAT64, common for mobile carriers).

**So the network transport layer works completely fine — packets genuinely
round-trip.** The failure is happening *above* that, inside Chromium's own
STUN/TURN protocol implementation, which receives a real response and then
fails to accept it (reported to JS as "timed out", which is Chromium's
generic message for "no valid response arrived in time" — it doesn't
distinguish "never arrived" from "arrived but was rejected").

### Where this was left

Confirmed to affect Edge and Electron equally, on two different networks,
against two different TURN servers (ours and a public one) — i.e. **not
fixable from application code, server config, or firewall/network
settings**. This is a machine-local Chromium/OS issue on the one specific
Windows PC used for testing, of unknown root cause. Things that were
**not** yet tried (listed for a future session, if this PC's issue is worth
chasing further):

- Test from a genuinely different physical Windows machine, to confirm this
  really is this-PC-specific and not some broader environmental factor.
- A new Windows user profile on the same PC (isolates per-profile
  corruption from system-wide).
- Check Windows Update history for a recent update that might correlate.
- `chrome://webrtc-internals` (or Edge's equivalent) itself, which has
  richer ICE-specific diagnostics than NetLog — NetLog's `net/` subsystem
  doesn't instrument WebRTC's own P2P/ICE code at all (checked: no
  STUN/ICE/TURN/P2P event types exist in NetLog's constants), so this
  avenue wasn't actually exhausted, just not reached before time ran out.

## 5. Where things landed / current config

- **Mobile**: `iceTransportPolicy: "relay"` — kept. Mobile's WebRTC engine
  (react-native-webrtc / Android libwebrtc) has never shown this problem;
  TURN allocation works reliably there.
- **Desktop**: `iceTransportPolicy: "relay"` **reverted to default** (no
  policy override — all candidate types allowed). Reasoning: forcing
  relay-only trades an intermittent, partially-understood mid-session drop
  for a *hard, total* connection failure on any machine that hits whatever
  this Chromium bug is — which we now know is a real, if rare, possibility.
  Default policy lets a connection succeed via a direct candidate whenever
  one is available (the common case for two genuinely separate networks
  anyway) and still use TURN when it's actually needed and working. This is
  the safer default for a wide range of real customer machines.
- The original ~40-second drop's *true* root cause is now uncertain (the
  original relay-then-switch theory doesn't fit well with "TURN never
  actually worked on the machine that saw the drop" — the working ~40s
  connection almost certainly never used TURN at all, meaning something
  else caused the drop). **Revisit if/when a real customer reports a
  similar mid-session drop** — with actual production usage data, this
  should be much easier to characterize than it was blind.
- All the smaller fixes in §2 (registry stale-ID fix, signaling logging,
  TURN-over-TCP, split-DNS, disabled Secure DNS, fixed CSP) are all kept —
  each is independently correct regardless of the big mystery above.

## 6. Reference

- Signaling: `wss://remote.bromeoremote.com` (server code: `server/`,
  Coolify resource "BromeoRemote Server")
- TURN: `turn:turn.bromeoremote.com:3478` (UDP + `?transport=tcp`), realm
  `bromeoremote.com`, user `bromeo` — credential in
  `client/src/shared/config.ts` / `mobile/src/shared/config.ts` /
  `coturn/turnserver.conf` (repo is private, credential committed directly
  per existing project convention)
- coturn config/compose: `coturn/turnserver.conf`, `coturn/docker-compose.yml`
- Coolify dashboard: `http://192.168.1.20:8000` (LAN only)
- OPNsense: `https://192.168.1.1` (LAN only)
