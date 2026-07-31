# Cross-network black screen — debugging log, 2026-07-31

**Symptom**: mobile connects to desktop successfully when both are on the
same network, but shows a black screen (with a visible cursor overlay,
looking "connected" but no video) whenever they're on *different* networks.
Eventually times out and returns to the connect screen.

This documents the full investigation and root cause, so a future
recurrence (by a human or an AI assistant) can be diagnosed in minutes
instead of hours. See also `docs/WEBRTC-TURN-DEBUGGING.md` for a related but
distinct earlier investigation (a machine-local Chromium bug on one specific
desktop, ruled out as the cause here).

## Fast diagnostic path (start here next time)

Don't re-derive this from scratch — follow this order, it's the fastest way
to find where the chain actually breaks:

1. **Rule out app-level regressions first.** Check
   `client/src/shared/config.ts` / `mobile/src/shared/config.ts`'s
   `DEFAULT_ICE_SERVERS` — do the TURN entries point at the *real* VPS IP?
   (As of this writing: `72.62.28.27`, also reachable via
   `turn:turn.bromeoremote.com:3478`.) A wrong/stale IP here is an easy
   mistake to reintroduce from old commit history (see §1 below) and looks
   identical to a real network problem.
2. **Get the desktop's own ICE log.** `%APPDATA%\BromeoRemote\ice-debug.log`
   — truncated fresh on every launch, captures every `[ice]`-prefixed
   console line from the main window (see `client/src/main/main.ts`'s
   `logIceLine`). Reproduce the black screen, then read the file. Look for:
   - Does a `local candidate: ... typ relay ...` line ever appear? If not,
     TURN allocation is failing outright (network/firewall problem — go to
     step 3).
   - If a relay candidate *does* appear, note its port number.
   - Does `connectionState` ever reach `connected`, or does it sit in
     `connecting`/`checking` until the 20s timeout fires?
3. **Get the mobile side's ICE log the same way**, since desktop and mobile
   are two independent peers and only one side working isn't enough:
   ```
   adb logcat -c
   adb logcat | findstr "[ice]"      (PowerShell: | Select-String "\[ice\]")
   ```
   (`adb.exe` lives under the Android SDK — `C:\Android\platform-tools\adb.exe`
   on the dev machine used for this investigation, if not on PATH.) Same
   thing: look for a `typ relay` candidate and whether `connectionState`
   reaches `connected`.
4. **If relay candidates appear on both sides but connectionState still
   never reaches `connected`**, note the exact port number(s) in the `typ
   relay` candidate lines (e.g. `72.62.28.27 54002 typ relay`) — this is
   almost certainly a port-range mismatch between what coturn actually
   allocates and what the firewall allows through. See §3.
5. **If no relay candidate appears at all**, packet-capture the VPS's WAN
   side while reproducing (OPNsense: Diagnostics → Packet Capture, or
   equivalent on whatever router sits in front of the *client* being
   tested) filtered to port 3478, and check whether requests even leave the
   network, and whether anything replies. Silence in both directions =
   client-side network/firewall problem. Requests leave but nothing replies
   = server-side problem (VPS firewall or coturn itself — see §2).

## What this was NOT (things checked and ruled out)

- **Not the Chromium-local bug from `docs/WEBRTC-TURN-DEBUGGING.md`** — that
  investigation found TURN failing identically even against an unrelated
  public TURN server, on one specific desktop machine. This time, a
  completely different public TURN server (`openrelay.metered.ca`) *also*
  failed identically at first — which looked like a repeat of that same bug,
  but turned out to be a red herring: at that point in the investigation,
  **nothing** could reach port 3478 on any server from that network, so of
  course an unrelated public server looked just as broken as our own.
- **Not OPNsense/home-network firewall rules** — the LAN's "Default allow
  LAN to any rule" is wide open; outbound UDP/TCP 3478 was never blocked
  client-side. A theory that removing an old port-forward rule (pointing at
  `192.168.1.20`, the old self-hosted coturn box) had broken outbound
  traffic was raised and disproven — that rule only ever affected *inbound*
  traffic to the home network, irrelevant to reaching an external VPS.
- **Not coturn itself being down/misconfigured at the process level** —
  confirmed running (`cat /proc/1/cmdline` inside the Coolify container
  showed `turnserver -c /etc/coturn/turnserver.conf -v`) and correctly bound
  to the real public IP on port 3478 for both UDP and TCP (confirmed via
  `cat /proc/net/udp` / `cat /proc/net/tcp`, decoding the reversed-hex local
  address field — `1B1C3E48:0D96` = `72.62.28.27:3478`).

## Root causes found (three, stacked)

### 1. Wrong TURN IP fallback reintroduced from stale history

While debugging, a literal-IP TURN fallback (`turn:62.45.93.36:3478`) was
restored from an old commit as "DNS flakiness insurance" — without
realizing that specific IP was the *developer's own home public IP* from
when coturn used to be self-hosted there (see
`docs/WEBRTC-TURN-DEBUGGING.md` for that history), not the current VPS. A
different, still-present commit (`eb18606`) had already removed this exact
entry with a documented reason (hairpin NAT, "garbage srflx addressing").
Re-adding it caused clients to burn their first connection attempt hammering
a dead address before anything else was even tried.

**Lesson**: never resurrect a removed fallback/IP from git history without
verifying it's still correct — check *why* it was removed first (`git log
-p` on the specific lines, not just the file).

Current correct value: `72.62.28.27` (both `client/src/shared/config.ts`
and `mobile/src/shared/config.ts`).

### 2. The VPS's own OS-level firewall (ufw) blocking port 3478 entirely

Hostinger's cloud-panel firewall was correctly opened for 3478/udp+tcp and
the relay range — but the VPS *also* runs `ufw` directly on the OS, as a
completely separate layer, with a **default-deny incoming** policy that
only explicitly allowed 22/80/443. Port 3478 wasn't in that list, so ufw
silently dropped everything (no RST, no ICMP — just gone), regardless of
what the cloud panel said. Traffic to port 443 on the same VPS worked fine
throughout (proving the VPS itself was reachable), which is what narrowed
this down to "something specific to 3478," not general connectivity.

**Lesson**: a cloud provider's panel-level firewall and the server's own
`ufw`/`iptables` are two independent, stacked layers. Opening one without
the other looks identical to "nothing works" from the outside — always
check both. `sudo ufw status verbose` is the fast check.

### 3. coturn allocating relay ports outside its own configured range

This was the real, final blocker, and the hardest to spot. Even after fixing
#1 and #2, and after confirming (via packet capture) that the port-3478
control channel worked end-to-end, the connection *still* failed. The
mobile side's `adb logcat` ICE log showed why: coturn happily handed out
`typ relay` candidates on ports like `50120`, `60797`, `49971`, `54002`,
`51771` — every single one **outside** the `min-port=49152` /
`max-port=49252` range declared in `coturn/turnserver.conf`. The firewall
(both Hostinger panel and ufw) had only been opened for that narrow
101-port range, so the actual relay data ports were still blocked, even
though allocation itself succeeded.

Root cause of *why* coturn ignores its own configured `max-port` was not
determined (possible stale/uncached config in the deployed container,
possible version-specific quirk — not worth chasing further once the
practical fix was found). The fix: widen the open range to match coturn's
real default (`49152-65535/udp`) on **both** the Hostinger panel and ufw,
which is also what `docs/DEPLOY.md` recommended from the start (the
narrower 49152-49252 was inherited from the old home-network OPNsense setup
and never should have been assumed to still apply). `coturn/turnserver.conf`
was updated to declare `max-port=65535` too, so the file at least stops
lying about the real range even though the firewall widening is what
actually fixed it.

**Lesson**: a relay candidate successfully being *allocated* (control
channel works) does not mean the actual *relay port* is reachable — those
are two different things that can fail independently. Always cross-check
the specific port number in a `typ relay` ICE candidate line against what's
actually open in the firewall, don't assume it matches the documented
range.

## Where things landed / current config

- `client/src/shared/config.ts` / `mobile/src/shared/config.ts`:
  `turn.bromeoremote.com:3478` (UDP+TCP) + `72.62.28.27:3478` (UDP+TCP,
  literal-IP fallback, **verified correct this time**) +
  `openrelay.metered.ca` (third-party public fallback).
- `coturn/turnserver.conf`: `min-port=49152`, `max-port=65535`.
- VPS firewall (Hostinger panel *and* `ufw`, both layers): `3478/tcp`,
  `3478/udp`, `49152:65535/udp`, all `ALLOW IN` / `Anywhere`.
- Both client and mobile also got a **hard 20-second connect timeout**
  during this investigation (independent of the root cause above, but a
  real improvement either way): if `connectionState` never reaches
  `connected`, the app now shows an explicit "Verbinding mislukt" error and
  returns to the connect screen, instead of an indefinite unexplained black
  screen. See `startViewerSession` in `client/src/renderer/app.ts` and
  `mobile/src/App.tsx` (`viewerConnectTimeoutRef` / `viewerConnectTimeout`).
- Shipped across desktop `v1.0.29`→`v1.0.30` and mobile `v0.0.29`→`v0.0.30`.

## Reference

- TURN: `turn:turn.bromeoremote.com:3478` / `turn:72.62.28.27:3478` (UDP +
  `?transport=tcp`), realm `bromeoremote.com`, user `bromeo` — credential in
  `client/src/shared/config.ts` / `mobile/src/shared/config.ts` /
  `coturn/turnserver.conf`.
- coturn config/compose: `coturn/turnserver.conf`,
  `coturn/docker-compose.yml` (`network_mode: host` — deliberate, needed for
  raw UDP relay ports; see the comment in that file).
- Coolify: manages the coturn container as its own resource ("BromeoRemote
  TURN"); its web Terminal gives a container-level shell (no `ps`/`ss`,
  minimal image — use `/proc/1/cmdline`, `/proc/net/udp`, `/proc/net/tcp`
  instead) — that's different from SSH to the VPS host itself, which is
  what's needed for `ufw`/`iptables`.
- Desktop ICE log: `%APPDATA%\BromeoRemote\ice-debug.log`.
- Mobile ICE log: `adb logcat`, filter `[ice]`.
