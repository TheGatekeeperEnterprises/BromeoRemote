# The "47 seconds" problem

## Status: root cause still unresolved. §4.11's OPNsense pf-timeout lead has been tested and ruled out — see §4.11a. Packet capture (§8 step 1) is now the top remaining lead.

Latest update 2026-07-24: §4.11's leading hypothesis — that OPNsense's
*default* pf UDP state timeouts (30-60s) on the coturn port-forward were
aging out the relay state around the observed ~45s failure window — has
been checked against the real box and **ruled out**. OPNsense's Firewall
Optimization is set to **"conservative"**, not default, which pf documents
as `udp.first 300s` / `udp.single 150s` / `udp.multiple 900s` — all far
past the observed window. See §4.11a. The `responsesReceived: 18 ≈ 45s ÷
2.5s ping interval` timing analysis in §4.11 is still believed correct
(that math doesn't depend on which optimization profile is active), but its
proposed *mechanism* (pf state aging) is now eliminated. The next concrete
step is the packet capture in §8 step 1 — still the only way to see
directly whether STUN responses stop being sent, stop arriving at
OPNsense's WAN interface, or arrive there but fail somewhere in the
NAT/forwarding path back to the client.

Prior update 2026-07-24 (research, no code changes): §4.9b flagged
`responsesReceived: 18` recurring identically across three independent drop
captures as "very unlikely to be coincidence... hasn't been investigated
yet." It's now investigated — see **§4.11**. Short version: 18 is not a
magic buffer size anywhere in libwebrtc. It's `~45 seconds ÷ libwebrtc's
default 2.5s steady-state STUN ping interval ≈ 18`, which means the failure
is **time-based (~45 wall-clock seconds after the pair stabilizes), not
count-based**.

Prior update 2026-07-24: after tuning the proactive-refresh mitigation
(15s interval, retrying recovery every 4s for a 20s grace window — see
§4.9b), a live session ran **4 minutes 45 seconds** before failing — up from
a hard ~47s ceiling, and further than the ~149s seen under the first
(30s-interval) version of this mitigation. Root cause is still not
confirmed; treat this as "pushed the failure far enough out," not "fixed."

Update 2026-07-24: a strict TURN/TCP-only relay test build caused an
immediate black screen instead of video. DevTools showed
`TURN allocate request timed out` for
`turn:turn.bromeoremote.com:3478?transport=tcp`, and a direct LAN check from
the desktop confirmed TCP 3478 is not reachable on the split-DNS target
`192.168.1.20` (`TcpTestSucceeded: False`). That means the app cannot rely
on TURN/TCP-only until coturn/the host firewall is fixed to accept TCP 3478.

The current app has therefore been reverted to normal ICE behavior on both
desktop and mobile: direct/STUN candidates are allowed, and both TURN/UDP
and TURN/TCP are offered as fallbacks. The drop's working theory remains
TURN/UDP consent/response loss around 47 seconds, but forcing TURN/TCP from
the app side is not a viable mitigation while the TCP listener/path is down.

App-side mitigation added 2026-07-24: viewers now proactively run an ICE
restart every 30 seconds, and a transient `disconnected` state gets a 12
second recovery window instead of ending the session immediately. The host
answers these refresh offers with the existing capture stream, so Android
should not ask for screen-share permission again during the refresh. This is
a workaround for testing stability while the coturn TCP listener and relay
port configuration are fixed server-side.

This document exists so another AI agent (or a human) picking this up cold
has everything gathered so far without re-deriving it. It was written on
2026-07-23 after a long live-debugging session against the real production
signaling server, real coturn deployment, a real phone, and a second
physical desktop machine (a laptop). If you are an AI reading this to try to
solve it: **read the "Ruled out" section before proposing a fix** — most of
the obvious first guesses have already been tested and eliminated with real
evidence, not just reasoning.

## 1. The symptom

A BromeoRemote session (mobile viewer ↔ desktop host, screen share + input
+ data channels over WebRTC) connects successfully — real video flows, real
input works — and then unilaterally drops after a strikingly consistent
**~40-48 seconds**, every time, regardless of network. The app's
auto-reconnect recovers within ~15 seconds, so end users see a brief freeze
and resume, not a hard failure. But the underlying cause is unknown.

This is **not** the same bug as the one documented in
`docs/WEBRTC-TURN-DEBUGGING.md` (see §7, "How this relates to the other
documented bug" — read that distinction before assuming they're the same
thing).

## 2. Architecture relevant to this bug

**Current 2026-07-24 note:** the app no longer forces relay-only here. Both
desktop and mobile are back on default ICE policy with STUN plus TURN/UDP and
TURN/TCP fallback. Viewers also schedule periodic ICE restarts to refresh the
selected path before the repeatable ~47-49 second consent failure. The older
bullets below describe earlier investigation states and should not be read as
the current build configuration.

- **Mobile** (`mobile/src/session.ts`) hardcodes
  `iceTransportPolicy: "relay"` — mobile *always* relays through TURN, on
  every connection, unconditionally. It never gathers a direct/srflx
  candidate. (The code comment above this line currently claims relay-only
  was adopted because "ICE switching to a better direct P2P pair mid-session
  ... is what caused sessions to drop ~40s in." **That theory is very likely
  stale/wrong** — see §5. Nothing in this investigation supports it, and
  given mobile can *only* gather relay candidates, there is no "direct pair"
  for it to switch away from in the first place.)
- **Desktop** (`client/src/renderer/session.ts`) uses the default ICE
  policy — host/srflx candidates are allowed, typically producing a
  `host/udp -> relay/udp` selected pair against a mobile viewer. A relay-only
  TURN/TCP-only test build was tried and reverted (see the 2026-07-24 note
  above) — TCP 3478 isn't currently reachable on the LAN target, so forcing
  TURN/TCP isn't viable yet.
- **coturn** is self-hosted via Coolify, reachable at `turn.bromeoremote.com`.
  Internally it's at `192.168.1.20`; externally (`external-ip` in
  `coturn/turnserver.conf`) it's `62.45.93.36`, which is simply this
  household's own public WAN IP (coturn is port-forwarded through the same
  OPNsense router that serves the household — this is a single-tenant,
  self-hosted relay, not a third-party service).
- **Split-DNS**: LAN clients (including the Windows desktop app *and the
  Android emulator, since it runs on the same physical Windows host*)
  resolve `turn.bromeoremote.com` straight to the internal `192.168.1.20`,
  bypassing the WAN entirely. This was added earlier (see
  `WEBRTC-TURN-DEBUGGING.md` §2.4) to fix a same-LAN hairpin issue. **Practical
  consequence for future debugging: testing with the Android emulator or any
  LAN-local client will never produce WAN-visible traffic for coturn, no
  matter how you time a packet capture.** Only a genuinely external client
  (a real phone on cellular data, or a client on a different network
  entirely) traverses the WAN and is visible there.
- Default coturn timers (unmodified in `coturn/turnserver.conf`): allocation
  lifetime 600s, permission lifetime 300s. **Both are far longer than 47s**,
  so a naive "TURN thing timed out" explanation doesn't fit on paper.

## 3. Diagnostic instrumentation already added (still in the code)

Both `client/src/renderer/session.ts` and `mobile/src/session.ts` have a
`dumpCandidatePairStats()` method that fires the instant
`iceConnectionState` first reports `"disconnected"`. It dumps the selected
candidate pair's stats (`bytesSent`, `bytesReceived`,
`lastPacketSentTimestamp`, `lastPacketReceivedTimestamp`,
`currentRoundTripTime`, `requestsSent`, `responsesReceived`,
`consentRequestsSent`) plus both candidates' type/protocol/address, to
`console.warn` under the tag `[ice] DROP DIAGNOSTIC`. This is intentionally
left in — it's cheap, only fires on disconnect, and has already produced the
most useful evidence below. A future debugger should open the desktop app's
DevTools console (or `adb logcat -s ReactNativeJS:V` on mobile) and watch
for these lines live.

## 4. Evidence gathered

### 4.1 Different failure signatures on different networks (this desktop PC)

- **PC on mobile hotspot** (desktop itself behind CGNAT): black screen,
  disconnects in ~16-18s. This is the *other*, already-documented,
  machine-specific Chromium TURN-allocate bug (`701 TURN allocate request
  timed out`, confirmed in `WEBRTC-TURN-DEBUGGING.md` to be isolated to this
  one Windows PC's Chromium install, reproducing identically in Edge and
  against a public TURN server). Not what this document is about.
- **PC on cable ethernet**: connects fine (real video), then drops at
  ~40-47s. This is the subject of this document.

### 4.2 A second physical machine reproduces it (this is the key finding)

The user tested BromeoRemote on a **laptop** — a genuinely different
physical Windows machine — on home WiFi (same household internet as the
desktop PC, but a different device entirely). Result: connects normally, no
black screen, but **still drops at ~47 seconds**. This single test is
important because it rules out "this one PC's broken Chromium install" as
the explanation for the 47s drop specifically (that theory only explains
the *hotspot/black-screen* case). Two different physical machines hitting
the identical ~47s ceiling points at something more systemic: the network
path, coturn itself, or a Chromium/libwebrtc behavior common to both
machines (both being fairly standard Windows/Chromium installs).

### 4.3 PC-to-PC (no TURN at all) never drops

The user also tested BromeoRemote **desktop-to-laptop** (both are PCs;
neither is mobile, so neither is forced into `iceTransportPolicy: "relay"`).
That connection **stays up indefinitely** — no drop at all. This isolates
the 47s ceiling specifically to sessions where TURN relay is actually part
of the active path. Since mobile always forces relay, *every* mobile↔desktop
session goes through coturn on the mobile leg at minimum, even when the
desktop itself uses a direct candidate.

### 4.4 Phone network type doesn't matter

The user connected via phone on **5G cellular** and separately on **home
WiFi** — both dropped at ~47-48s. This rules out the phone's specific
carrier NAT/CGNAT behavior as the cause (a common initial suspect, since
mobile carrier NAT is notoriously aggressive — but it fails identically on
WiFi too, so it's not carrier-specific).

### 4.5 No hardcoded timer anywhere in the codebase

Grepped `client/src`, `mobile/src`, `server/src`, `coturn/turnserver.conf`,
`coturn/docker-compose.yml` for any `setInterval`/`setTimeout`/lifetime
value anywhere near 40000-48000ms. **Nothing found.** The only intervals
that exist are unrelated (2s stats polling, 1s UI countdown timers, a 60s
rate-limiter cleanup on the signaling server). Whatever causes this is not
an app-level timer — it's happening at the network/protocol level.

### 4.6 Live candidate-pair diagnostic captures (real numbers)

Two separate drop events were captured via the `dumpCandidatePairStats()`
instrumentation (§3) on the desktop, during emulator-based testing (see the
caveat in §2 about emulator traffic being LAN-local — these specific numbers
are from a same-LAN test, so treat the literal addresses as an artifact of
that setup, but the *shape* of the numbers is still informative):

**Capture 1:**
```
state: "in-progress", nominated: true
bytesSent: 5,053,081   bytesReceived: 40,095
local candidate:  host  / udp / 192.168.1.128 (desktop's own LAN address)
remote candidate: relay / udp / 192.168.1.20  (coturn's LAN address — confirms
                                                 mobile really did relay through it)
```

**Capture 2** (fuller, from a slightly later repeat of the same test):
```
state: "in-progress"
nominated: true
bytesSent: 6,388,720
bytesReceived: 40,714
consentRequestsSent: 87
currentRoundTripTime: 0.002–0.011  (2–11ms — fast, LAN-speed in this test)
lastPacketReceivedTimestamp: 1784834209690
lastPacketSentTimestamp:     1784834216721   (≈ 7.0s after last received)
requestsSent: 89
responsesReceived: 18
```

Two things stand out:

1. **`requestsSent: 89` vs `responsesReceived: 18`** — roughly an 80-88%
   loss rate on STUN consent-freshness responses over the life of the pair
   (this is a cumulative counter for the whole connection, not just the
   final seconds — meaning response loss was happening substantially
   throughout the session, not just right before the drop).
2. **`lastPacketSentTimestamp − lastPacketReceivedTimestamp ≈ 7 seconds`** —
   the desktop kept sending consent-freshness requests for ~7 seconds after
   it last heard anything back, before ICE gave up and declared
   `disconnected`.

Real data clearly flowed (`bytesSent` in the megabytes — that's the actual
video). This was not a connection that never worked; it degraded.

### 4.7 coturn's own server logs are clean

During a live cycle, the user pulled coturn's live log from Coolify's log
viewer. For the actual active session IDs, it's completely unremarkable:
`CREATE_PERMISSION processed, success` and `CHANNEL_BIND processed, success`
firing roughly every second, continuously, permission lifetime refreshed to
300s repeatedly, right up until the connection ended — **no error, no
timeout, no unexpected delete for the live session.** Two *other*, older
session IDs were cleaned up with `reason: allocation timeout` during the
same window, but those were leftovers from earlier, already-dead connection
attempts (normal garbage collection), not the live one.

One anomaly worth flagging: two session IDs
(`003000000000000330` / `000000000000000355`, seen across two different
capture windows) show **`ALLOCATE processed, success` repeating many times
in a row for the same session ID**, roughly once per second, over tens of
seconds. A TURN allocation should only need one successful `ALLOCATE` —
repeated `ALLOCATE` for an already-allocated session is the server-side
signature of a client that keeps re-sending the request as if it never
received the prior success response, even though coturn *did* send it and
logs it as successful every time. This is suggestive of a response-delivery
problem on the path back to whichever client owns that session, but it
wasn't conclusively tied to the specific 47s-drop session — it's a lead, not
a confirmed cause.

### 4.8 Live WAN packet capture (OPNsense, real phone)

Captured on OPNsense's WAN interface (`Delta_vlan107` / `vlan01`), filtered
to port 3478, during a real phone connection (finally exercising the actual
external path, unlike LAN/emulator tests — see §2). This confirmed:

- The phone (public IP `77.63.50.211`, briefly also seen as `77.63.32.218`)
  correctly reaches coturn's public address `62.45.93.36:3478`.
- Multiple parallel candidate probes open on different ports (both UDP and
  TCP — `?transport=tcp` fallback candidates included) — this is normal ICE
  behavior, gathering several candidates and discarding the losers via
  FIN/RST once one wins.
- One UDP port (4287 in one capture, 4312 in a later one) becomes the
  winning/active channel and its packet sizes grow into genuine video-frame
  territory (1145–1260 bytes per packet) — confirming real TURN-relayed
  media flow, working correctly, at least at the start of the session.
- **The exact packet-level view of the drop moment itself was never
  successfully captured** — every attempt to correlate emulator-timing with
  a WAN capture failed because of the split-DNS LAN-bypass issue (§2), and
  a later attempt with the real phone ran out of session time/turns before
  the precise drop-moment window could be pulled. **This is the single
  biggest gap in the evidence — see §8.**
- Unrelated noise also visible in the same capture: a completely separate,
  unrelated device on the household network pings `35.156.116.167:3478`
  every ~54 seconds, continuously, regardless of BromeoRemote's connection
  state. Confirmed unrelated (some other STUN-using consumer
  device/service) — don't chase this.

### 4.9a First live validation of the periodic ICE-restart mitigation (2026-07-24)

With `ICE_REFRESH_INTERVAL_MS = 30_000` and `DISCONNECTED_GRACE_MS = 12_000`
in place (§2, "App-side mitigation added 2026-07-24"), a real phone session
against the real desktop ran for **2 minutes 29 seconds** before finally
failing the same way it always has — well over 3x the previous ~47s ceiling.
The desktop console showed 4 clean scheduled ICE-restart cycles (candidate
`generation` incrementing 0→1→2→3, each ~30s apart) before the connection
finally gave out. At failure, the same signature reappeared: `701 TURN
allocate request timed out`, then `disconnected`/`failed`, with the
candidate-pair dump showing `requestsSent: 45` / `responsesReceived: 18`
(~40% response rate — better than the ~20% seen pre-mitigation, but still
substantial loss) and `bytesSent: 14,156,607` (≈14MB, consistent with the
much longer session).

Other sessions logged around the same time showed short durations (49s,
48s, 5s, 4s) — the 49s/48s ones are from *before* this mitigation was
deployed (matching the old ~47s ceiling) and the 4s one was the user
deliberately closing the session, not a failure. Only the 2m29s session
actually tested the new code end-to-end.

**Read on this one data point:** the periodic ICE restart is a genuine,
working mitigation — it measurably extends session life — but it is not a
fix. The same underlying response-loss degradation (§4.6) still eventually
catches up and kills the connection; the restart loop just buys time before
that happens. More data points are needed to know whether 149s is typical
under this mitigation or this run was unusually good/bad, and whether a
shorter refresh interval (e.g. 15s, restarting before the degradation has a
chance to accumulate as much) would extend it further or just delay the
same outcome proportionally.

### 4.9b Shortened interval + persistent retry: no drop after 4+ minutes (2026-07-24)

Following up on §4.9a's open question, `ICE_REFRESH_INTERVAL_MS` was cut
from 30s to **15s**, and `scheduleDisconnectRecovery()` was changed from a
single restart attempt + passive 12s wait to a **retry every 4 seconds for a
20-second grace window** (`DISCONNECT_RETRY_INTERVAL_MS` /
`DISCONNECTED_GRACE_MS`) — so a recovery attempt that itself fails to land
(e.g. it fires while `signalingState` isn't `"stable"` yet) gets several more
chances instead of the session just dying when the single attempt doesn't
work out. Same change applied identically to both
`client/src/renderer/session.ts` and `mobile/src/session.ts`.

Live result on a real phone↔desktop session: it finally failed at
**generation 19** — roughly 4 minutes 45 seconds (19 × 15s), the longest
session observed in this whole investigation, up from the ~47s original
ceiling and the ~149s first-mitigation result in §4.9a. Every refresh cycle
up to that point completed cleanly (gathering → complete, no errors); the
eventual failure had the exact same signature as always: `701 TURN allocate
request timed out` → `iceConnectionState: disconnected` →
`connectionState: disconnected`.

**A striking new pattern in the final `DROP DIAGNOSTIC` dump:**
```
bytesSent: 14,538,824   bytesReceived: 45,039
consentRequestsSent: 48
requestsSent: 49
responsesReceived: 18
lastPacketReceivedTimestamp: 1784848958432
lastPacketSentTimestamp:     1784848964977   (≈6.5s later)
```
`responsesReceived: 18` is **the exact same number** seen in two earlier,
independent captures (§4.6's capture 2: `89 requests / 18 responses`, and
§4.9a: `45 requests / 18 responses`). Three separate sessions, three
different `requestsSent` totals (89, 45, 49), three completely different
session lengths — and `responsesReceived` lands on exactly 18 every single
time. That is very unlikely to be coincidence and hasn't been investigated
yet. Possible explanations worth checking: some fixed-size buffer/counter in
libwebrtc's consent-freshness accounting for a candidate pair that saturates
or wraps at 18; a NAT/port-mapping-table limit on the router or coturn side
that accepts exactly 18 responses through a given mapping before something
resets; or a coturn-side per-permission/per-channel response-count ceiling.
**Whoever picks this up next: try to find out if "18" means something
specific in libwebrtc's RTCIceCandidatePairStats implementation, or in
coturn's response handling — this is the most concrete, reproducible number
in the entire investigation.**

**This is the strongest result so far** — going from a hard ~47s ceiling, to
~149s under the first (30s-interval, single-attempt) mitigation, to 4+
minutes and still climbing under the shortened/retrying version. It does
**not** confirm the underlying degradation is gone — the leading hypothesis
in §6 (STUN response delivery degrading over time on the TURN-relayed path)
would still predict *eventual* failure, just pushed further out the more
aggressively the path gets refreshed. Whether this specific tuning
(15s / 4s-retry / 20s-grace) is a durable practical fix for real usage, or
just moves the ceiling further without removing it, needs more/longer live
sessions to confirm. If future testing shows sessions eventually still fail
even under this tuning, that data point (how long it took) is valuable —
add it here rather than starting a new section.

### 4.9 A/B test against a public TURN server was inconclusive

Mobile was temporarily reconfigured to use `openrelay.metered.ca` (a public,
free TURN test server) instead of the self-hosted coturn, to see if the 47s
ceiling was specific to this coturn deployment. The connection never even
reached `connected` — it got stuck at `checking` and stayed there. This
didn't prove or disprove anything about coturn; it's more likely that the
free/shared public relay is itself unreliable or rate-limited. **This
specific A/B test is worth redoing more carefully** if pursuing the
"is-it-coturn-specifically" angle — ideally against a different,
professionally-run TURN provider (e.g., a paid Twilio/Xirsys STUN/TURN
trial), not a free shared one.

### 4.10 A tempting-but-unconfirmed lead: Windows Update timing

Early in the *original* investigation (the one in
`WEBRTC-TURN-DEBUGGING.md`), a Windows cumulative update (`KB5121767`)
finished installing via reboot at 03:28:20 on the same morning, about 10
minutes before TURN-allocate troubleshooting commits started appearing in
git history. This was flagged as a possible correlation but **never actually
tested** (the user chose to pursue the cross-machine laptop test instead,
which was more immediately informative and pointed away from "one PC's
software state" anyway, since the laptop reproduces the 47s drop too). Given
§4.2 (two different physical machines both affected), this specific lead is
now considered low-priority — a Windows Update on one specific PC can't
explain a second machine's laptop showing the same symptom, unless both
machines happened to install the same cumulative update around the same
time (unconfirmed, not checked).

### 4.11 Researched: what "responsesReceived: 18" actually means, and a new server-side lead (2026-07-24)

§4.9b left `responsesReceived: 18` as an open question — identical across
three captures with `requestsSent` at 89, 45, and 49 respectively, and
flagged as "very unlikely to be coincidence... hasn't been investigated
yet." This entry investigates it, via web research against libwebrtc's
actual source/docs and pf/OPNsense's documented defaults (no live testing
was available in this session — see "what's still unconfirmed" below).

**libwebrtc's steady-state STUN ping interval is 2.5 seconds.** Once a
candidate pair is stable and writable, libwebrtc's
`stable_writable_connection_ping_interval` default is 2500ms (confirmed via
Chromium/webrtc.googlesource.com source search). `18 responses × 2.5s =
45 seconds` — matching the observed ~40-48s drop window almost exactly.
This is very likely the whole explanation for why "18" recurred across
sessions with wildly different `requestsSent` totals: `requestsSent` is
cumulative for the pair's *entire* life (including the faster pre-stable
connectivity-check phase, plus whatever kept firing during the ~6-7s
no-response grace period noted in §4.6/§4.9b before ICE gives up) — so it
naturally varies session to session. `responsesReceived`, on the other
hand, is governed by *how long responses kept arriving normally* divided by
the fixed 2.5s cadence, and that duration is consistently ~45s. **This
reframes the mystery**: 18 is not a magic buffer size, count-based cap, or
wraparound anywhere in libwebrtc or coturn. The failure is **time-based**
— something breaks the *response* path back to the client at a roughly
fixed wall-clock offset (~45s) after the pair stabilizes, regardless of how
many requests have been sent by that point. This matches §6's existing
leading hypothesis (response delivery degrading over time on the
TURN-relayed path) but narrows it from "over time" to "at a specific,
consistent ~45s mark."

**What ages out around 30-60 seconds, on a path every single failing test
in this document shares?** Every test so far has varied the *client* side
(PC on hotspot, PC on ethernet, a second physical laptop, phone on 5G,
phone on WiFi) and still hit the same ~45-47s ceiling. The one thing that's
**never** varied is the *server* side: OPNsense, port-forwarding to the
same self-hosted coturn instance (§2). OPNsense is pf-based (FreeBSD's
packet filter), and pf's documented default UDP state timeouts are:
`udp.first 60s`, `udp.single 30s`, `udp.multiple 60s` — all three land
squarely inside the observed failure window, and pfSense/OPNsense's
"Conservative" optimization profile (which would push these out to
150-900s and rule this theory out) is a non-default opt-in setting, not
what a fresh install ships with. The plausible mechanism: the coturn
relay's traffic pattern on this state is heavily asymmetric — a large,
steady stream of actual video bytes in one direction, versus small, sparse
STUN consent-freshness request/response pairs riding the same 5-tuple —
and if pf's state promotion/refresh logic doesn't treat the small sparse
control-packet exchange as sufficient to keep the state in its longer-lived
tier the same way ordinary bidirectional traffic would, the state (or just
its return-path forwarding) could degrade or get pruned around the
30-60s mark while the one-directional bulk video keeps `bytesSent`/interface
counters looking healthy — which is exactly what §4.6 observed (real video
kept flowing right up to the drop).

**What's still unconfirmed** (this was research against public
documentation, not a test against the real box):
- Whether this OPNsense instance is actually running default (not
  "Conservative" or custom) firewall optimization settings.
- Whether the *actual* state-table entry for a live coturn relay session
  shows a timeout/expiry consistent with `udp.single`/`udp.multiple`, or
  something else entirely — check via OPNsense's own state table viewer
  (**Firewall: Diagnostics: States**, filter to the coturn relay port
  range) during a live session, ideally watching it right as the drop
  happens.
- Whether OPNsense exposes a way to override this per-rule (per the pf
  ecosystem, pfSense's Advanced/Firewall & NAT page has manual state
  timeout overrides; OPNsense's GUI reportedly does not expose the same
  per-rule control as of recent versions — a system-wide tunable or a
  custom floating rule may be the only lever available). If per-rule
  control isn't available, a quick way to test the theory without a
  permanent change is a temporary `pfctl` state-timeout adjustment from the
  OPNsense shell during a live test session.

**Suggested next step, concretely**: during a live phone session, open
OPNsense's **Firewall: Diagnostics: States** page (or `pfctl -s state` from
the shell) filtered to the coturn relay port(s), watch the specific state
entry for the active session, and see whether it ages out, gets pruned, or
its counters/timeout behave unusually right around the 40-48s mark. If it
does, raising the relevant UDP state timeout (system-wide, or via a
dedicated floating rule for the coturn port range if OPNsense allows it) is
a concrete, testable, low-risk fix to try next — unlike most of the earlier
leads in this document, this one has a specific, checkable, and
potentially directly fixable mechanism behind it rather than requiring
more packet captures to even form a hypothesis.

### 4.11a Tested and ruled out: OPNsense is on the "conservative" profile (2026-07-24)

The first, cheapest check from §4.11 was run: **System: Settings: Advanced:
Firewall** (`system_advanced_firewall.php`) shows **Firewall Optimization:
conservative** — confirmed via a real screenshot of the live OPNsense admin
UI, not assumed. pf's documented "conservative" profile timeouts are
`udp.first 300s` / `udp.single 150s` / `udp.multiple 900s` — the shortest
of the three (150s) is still more than 3x the observed ~45-48s failure
window. **This eliminates §4.11's proposed mechanism** (pf's default UDP
state timeout aging out the relay state) as the explanation. The rest of
§4.11's live-testing checklist (watching the actual state-table entry
during a session, checking for a per-rule override) is now moot — there's
nothing to override; the timeouts already in effect are nowhere near the
failure window, full stop.

**What this does and doesn't tell us:**
- It does **not** invalidate the timing analysis (18 responses × 2.5s ping
  interval ≈ 45s) — that arithmetic doesn't depend on which firewall
  profile is active, and the *pattern* (responses stop arriving at a
  consistent wall-clock offset, not a consistent request count) is still
  real and still needs an explanation.
- It rules out the specific *server-side pf state-timeout* mechanism as
  that explanation. Whatever's actually happening at ~45s is either:
  happening somewhere other than OPNsense's state table (coturn itself,
  Chromium/libwebrtc's own handling, or something router-adjacent but not
  pf-timeout-shaped), or is pf-related but through a different mechanism
  than a plain state-timeout (e.g., something in how OPNsense's NAT
  reflection/port-forward rule itself is configured, rather than the
  general state-timeout tunables — not investigated).
- The one remaining way to actually *see* what happens at the 45s mark,
  rather than reason about it, is the packet capture in §8 step 1
  (never yet successfully completed in this whole investigation — see
  §4.8's note on why prior attempts failed). That's now the top priority.

## 5. Ruled out

- ❌ **A hardcoded app-level timer.** Exhaustively grepped, none exists near
  this duration anywhere in the codebase.
- ❌ **This one PC's Chromium bug** (the black-screen/701-allocate-failure
  one from `WEBRTC-TURN-DEBUGGING.md`) as the explanation for the 47s drop
  specifically. That bug is real and machine-specific, but the 47s drop
  reproduces on a second, unaffected machine (the laptop) too, so it can't
  be the same root cause.
- ❌ **The phone's specific network** (5G vs WiFi) — both show it.
- ❌ **A home-router/OPNsense NAT idle-timeout, in any form checked so far.**
  PC-to-PC sessions on the exact same router/network never drop at all
  (rules out the *naive* version). §4.11 then proposed a more specific
  version — pf's *default* UDP state timeouts (30-60s) applied specifically
  to the TURN-relay port-forward's asymmetric traffic pattern — as the
  leading lead. §4.11a checked it directly against the real box: OPNsense
  is running the **"conservative"** optimization profile (150-900s
  timeouts), not default, so this specific mechanism is also ruled out. Not
  fully closed as a *category* (a non-timeout pf/NAT mechanism, like the
  port-forward/reflection rule's own config, hasn't been checked), but the
  concrete, testable version of this theory is dead. See §4.11a.
- ❌ **coturn actively closing/erroring the session** — its own logs are
  clean for the live session; whatever's failing isn't coturn deciding to
  terminate anything.
- ✅ **(Resolved, no longer applicable)** The old in-code comment in
  `mobile/src/session.ts` claiming the 40s drop was caused by "ICE switching
  to a better direct P2P pair mid-session" — this and the
  `iceTransportPolicy: "relay"` line it sat above are both already gone as
  of the 2026-07-24 revert to default ICE policy on both platforms (see the
  top-of-document update note and §2). Confirmed by grep: neither string
  exists in `mobile/src/session.ts` anymore. §8's old cleanup item for this
  is moot and has been removed.

## 6. Leading hypothesis (unconfirmed)

Something degrades STUN consent-freshness response delivery *back to the
client* over the TURN-relayed path specifically, over the course of a
session, until enough consecutive failures accumulate and libwebrtc's ICE
agent declares the pair dead — independent of real media data, which
appears to keep flowing fine in the same window (bytesSent stayed high).
The `~89 requests / 18 responses` ratio (§4.6) and the repeated-`ALLOCATE`
anomaly in coturn's logs (§4.7) both point at *response delivery*, not
request delivery or coturn-side processing, as the weak link — but whether
the actual fault lies in Chromium/libwebrtc's handling of TURN-relayed STUN
responses, in coturn's response transmission under sustained relay load, or
in some network-path characteristic common to both test machines' setup, is
not resolved.

**Update per §4.11**: "over the course of a session" above should now be
read as "at a consistent ~45 wall-clock seconds after the pair stabilizes"
— the response-loss timing lines up with libwebrtc's fixed 2.5s
steady-state ping interval (18 × 2.5s ≈ 45s), not with request count. That
sharpens "some network-path characteristic" toward OPNsense's default pf
UDP state timeouts (30-60s) on the coturn port-forward specifically — the
one path element common to every failing test regardless of which client
device or network was used. Still unconfirmed against the real running
config; see §4.11 for exactly what to check.

## 7. How this relates to the other documented bug

`docs/WEBRTC-TURN-DEBUGGING.md` describes a **separate, already
deeply-investigated bug**: this one specific desktop PC's Chromium install
cannot complete a TURN *allocate* at all, ever, confirmed via NetLog,
confirmed identical in Edge (non-Electron) and against a public TURN server,
confirmed unrelated to CSP/firewall/coturn-config/DNS. That bug causes total
connection failure (black screen) specifically when the *desktop itself*
needs to use TURN (e.g., desktop on a restrictive network like a mobile
hotspot). It was concluded to be machine-local and not fixable in this
project's code.

**This document's bug is different**: it happens even when the desktop
*doesn't* need TURN (direct candidate works fine, video starts normally),
reproduces on a second, otherwise-unaffected physical machine, and
specifically implicates the TURN relay path that mobile is always forced
through. Don't conflate the two — a fix for one will not fix the other.

## 8. Suggested next steps (not yet done)

In rough priority order, for whoever picks this up next:

**0. ~~Check OPNsense's live state-table entry~~ — done, ruled out (§4.11a).**
   OPNsense is on the "conservative" optimization profile (150-900s UDP
   state timeouts), confirmed via the live admin UI, so pf's default
   state-timeout mechanism proposed in §4.11 cannot be the cause. No live
   state-table test needed — this was closed by the quick config check
   alone. **The packet capture below (step 1) is now the top remaining
   priority** — it's the only lead left that would show what's actually
   happening at the 45s mark rather than reasoning about it from stats
   snapshots.
0a. **Gather more data points on the periodic ICE-restart mitigation.**
   §4.9b already pushed a real session to 4m45s with a 15s refresh
   interval / 4s retry / 20s grace window — tuning further (e.g. an even
   shorter interval) is possible but has diminishing room; more valuable
   now is simply running several more real-phone sessions under the
   current tuning and logging how long each lasts, to see whether ~4-5min
   is a stable new ceiling or highly variable session to session.
1. **Capture the exact drop-moment packets.** Every attempt in this session
   either hit the split-DNS LAN-bypass trap (§2, testing with the emulator
   or any LAN client is useless for this) or ran out of time coordinating
   the real phone's drop moment with a live OPNsense packet capture. Do this
   properly: start the WAN packet capture first, connect with a *real
   phone on cellular data*, note the exact connect timestamp, wait the full
   ~47s, and pull the capture filtered tightly to the phone's public IP and
   port for just the 10-second window around the expected drop. Look
   specifically for whether responses stop arriving at the router at all,
   or arrive at the router but something about their delivery back to the
   client fails.
2. **Pull `chrome://webrtc-internals`' full JSON stats export** (its
   "Create Dump" button) during a live session, from connect through drop.
   This gives complete historical per-second stats for every candidate pair,
   not just a single freeze-frame at disconnect — far richer than the
   `dumpCandidatePairStats()` console instrumentation currently in place.
   This was planned but never actually executed in this session due to
   browser window-focus automation problems unrelated to the app itself.
3. **Redo the public-TURN-server A/B test** (§4.9) against a
   professionally-run TURN provider (not a free shared one like
   openrelay.metered.ca) to get a clean answer on whether this is
   coturn-specific or more general.
4. **Fix and verify coturn TCP 3478 before trying TURN/TCP-only again.**
   From a LAN Windows client, `Test-NetConnection turn.bromeoremote.com -Port
   3478` currently resolves to `192.168.1.20` but fails the TCP test. On the
   Coolify host, verify coturn is listening on TCP 3478 and that the host
   firewall allows it. Only after that should a relay/TCP-only diagnostic
   build be retried.
5. Consider whether coturn needs any tuning for sustained relay sessions
   (e.g., `channel-lifetime`, `min-port`/`max-port` range exhaustion under
   load, thread/worker count) — nothing was changed here, this is untested.

## 9. Relevant files

- `client/src/renderer/session.ts` — desktop WebRTC session, has the
  `dumpCandidatePairStats()` diagnostic (§3), the (correct, current)
  comment explaining why desktop uses default ICE policy, the periodic
  ICE-restart failsafe (§4.9b), and `setFailsafeEnabled()` — the
  Settings-driven toggle for that failsafe (added after this document's
  "root cause" work; see the failsafe UI in `index.html`'s view-menu).
- `mobile/src/session.ts` — mobile WebRTC session, same diagnostic,
  failsafe, and `setFailsafeEnabled()` as the desktop client above (kept in
  sync). No longer hardcodes `iceTransportPolicy: "relay"` — see §5.
- `client/src/shared/config.ts` / `mobile/src/shared/config.ts` —
  `DEFAULT_ICE_SERVERS`, both STUN and coturn UDP/TCP entries.
- `coturn/turnserver.conf`, `coturn/docker-compose.yml` — coturn config,
  unmodified defaults for lifetimes.
- `docs/WEBRTC-TURN-DEBUGGING.md` — the *other*, separate, already-resolved
  (as "not fixable in app code") bug. Read §7 above before assuming overlap.
