# MapLibre Airplane PWA

An installable React + Vite progressive web app that stages a lightweight
flight experience over an open-source 3D map stack.

## What is here

- MapLibre GL JS with OpenFreeMap vector tiles and 3D buildings
- Terrain relief from raster DEM tiles
- A rudimentary Three.js airplane rendered as a custom MapLibre layer
- Three scenic route plans with a front-door mission selector
- Autopilot orbit mode plus manual/touch override
- One-lap checkpoint scoring with medal timing, finish state, and terrain-strike failure
- Fastlane-driven verification for the GitHub Pages publish workflow

## Controls

Keyboard:

- `W` / `ArrowUp`: pitch up
- `S` / `ArrowDown`: pitch down
- `A` / `ArrowLeft`: bank left
- `D` / `ArrowRight`: bank right
- `Q` / `E`: throttle down / up
- `M`: toggle autopilot/manual
- `C`: cycle chase/cinematic/free camera
- `R`: reset position or restart an ended run
- `Space`: pause or resume

Touch:

- On mobile/coarse-pointer devices, the lower control deck mirrors pitch, bank, and throttle
- Manual mode resolves into medal-scored finishes or terrain-strike failures

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the merged cinematic arcade + sim-lite plan, release milestones, and file-level workstreams.

## Local development

```bash
npm install
bundle install
npm run dev
```

## Verification

```bash
npm run lint
npm run build
bundle exec fastlane publish
```

## iPad VPN debugging

See [`IPAD_VPN_DEBUGGING.md`](./IPAD_VPN_DEBUGGING.md) for the exact `~/vpn_interconnect` handoff, required Codex skills, and the sample-lab versus app-specific VPN lanes. As of April 3, 2026, the LAN control path was previously proven, but the VPN control path still fails until the iPad produces a real `10.100.0.0/24` fetch.
