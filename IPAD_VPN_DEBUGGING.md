# iPad VPN Debugging

This runbook documents the exact lanes needed to prove this app on a VPN-backed iPad Safari path.

Status as of April 3, 2026:

- LAN-backed Safari automation was previously proven through the sample lab at `http://192.168.2.46:3000/`.
- VPN-backed Safari automation is not yet proven. The current failing control case is `make ios-webkit-rust-vpn-ipad-self-test`, which reports `Observed Client IPs: none` for the expected `10.100.0.0/24` subnet.

## Required skills

Use these Codex skills for future runs:

- `ios-website-sample-debugging-rust`: mandatory for real-device iPad probes because it requires before/after screenshots and the Rust wrapper verification path.
- `workspace-filesystem`: needed to inspect local repo state, logs, screenshots, and generated artifacts without guessing paths.
- `repo-git-ops`: needed when the runbook or supporting files change and the result needs to be reviewed, committed, and pushed cleanly.

## First-time prerequisites

On the iPad:

- `Settings -> Apps -> Safari -> Advanced -> Web Inspector`
- `Settings -> Apps -> Safari -> Advanced -> Remote Automation`
- WireGuard app installed
- the client config from `~/vpn_interconnect/out/wireguard/` imported into WireGuard
- the WireGuard tunnel actively connected before Safari launch

On the Linux host:

- `wg0` must be up
- the iPad must stay unlocked and trusted over USB
- `go-ios`, `pymobiledevice3`, `tidevice`, and `libimobiledevice` must already be installed

## VPN bring-up lane

Use `~/vpn_interconnect` as the source of truth for the local WireGuard state:

```bash
cd /home/standard/vpn_interconnect
make vpn-client-conf
make connect-me-to-vpn
make vpn-ensure-report
ip -4 -o addr show wg0
```

What to look for:

- `wg0` exists
- the host has a `10.100.0.x` address
- on April 3, 2026 this host reported `10.100.0.112/32`

If the iPad needs a refreshed profile, regenerate the config in `~/vpn_interconnect` and re-import it into the WireGuard app before attempting Safari automation.

## Sample-lab control lane

Always validate the known sample first. If the sample cannot fetch over VPN, this app is not the problem.

```bash
cd /home/standard
make ios-webkit-rust-build
make ios-webkit-rust-status
make ios-webkit-rust-vpn-ipad-self-test
```

Interpretation:

- pass: the iPad really fetched `http://10.100.0.x:3000/...` and the JS-shell probe resolved `location.href`
- fail with `Observed Client IPs: none`: the iPad never fetched the VPN URL
- fail with only `about:blank` tabs: Safari automation is still not reaching the target page

Current control-case evidence from April 3, 2026:

- `/home/standard/subprojects/IOS_WEBSITE_SAMPLE_DEBUGGING/run/js-shell-probe.json`
- `/home/standard/subprojects/IOS_WEBSITE_SAMPLE_DEBUGGING/run/sample-site.log`

Both show that the host-side `_hostcheck` succeeded but the iPad never produced a real VPN client fetch.

## MapLibre app lane

Build and host this repo on a plain logged HTTP port:

```bash
cd /home/standard/submodules/maplibre-airplane-pwa
npm run build
python3 -u -m http.server 4175 --bind 0.0.0.0 -d dist
curl -I http://10.100.0.x:4175/
```

For the current machine the tested URL was:

```bash
http://10.100.0.112:4175/
```

## Device-control lane

On this host, the stable `go-ios` control path used a userspace agent-backed tunnel. Start it like this:

```bash
sudo env ENABLE_GO_IOS_AGENT=user \
  /home/standard/.local/bin/ios \
  --tunnel-info-port 28100 \
  tunnel start \
  --udid 00008110-001408611A60401E \
  --userspace
```

Then query the agent-owned tunnel registry:

```bash
curl http://127.0.0.1:60105/tunnels
```

For this iPad, the important operational detail was:

- `ios screenshot` succeeded only when using `--tunnel-info-port 60105`
- the older kernel-style tunnel metadata on `28100` was not enough by itself

## Required screenshot lane

The real-device workflow must capture screenshots before and after each probe:

```bash
ios --tunnel-info-port 60105 screenshot \
  --udid 00008110-001408611A60401E \
  --output /home/standard/subprojects/IOS_WEBSITE_SAMPLE_DEBUGGING/run/screenshots/maplibre-airplane-vpn-before.png

ios --tunnel-info-port 60105 screenshot \
  --udid 00008110-001408611A60401E \
  --output /home/standard/subprojects/IOS_WEBSITE_SAMPLE_DEBUGGING/run/screenshots/maplibre-airplane-vpn-after.png
```

## Safari launch lane

For this app:

```bash
pymobiledevice3 webinspector launch \
  --udid 00008110-001408611A60401E \
  --timeout 10 \
  http://10.100.0.112:4175/
```

Then verify with:

```bash
pymobiledevice3 webinspector opened-tabs --udid 00008110-001408611A60401E
```

Important host-specific rule:

- `pymobiledevice3 webinspector launch` timing out is not proof of failure on its own
- the source of truth is a real iPad fetch in the server log and a successful JS-shell probe

## Decision lane

Use this order every time:

1. `~/vpn_interconnect`: prove `wg0` is up.
2. Sample lab VPN lane: prove the iPad can fetch a known page over `10.100.0.0/24`.
3. Only after step 2 passes, retry the MapLibre app VPN lane.

If step 2 fails, stop there. The bug is still in VPN reachability or iPad-side VPN usage, not in this app.

## Current known blocker

As of April 3, 2026, this repo is not yet debuggable over VPN on the connected iPad because the control sample still fails to receive a real client fetch from the iPad over the expected VPN subnet.
