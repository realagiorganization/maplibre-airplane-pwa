# MapLibre Airplane PWA

An installable React + Vite progressive web app that stages a lightweight
flight experience over an open-source 3D map stack.

## What is here

- MapLibre GL JS with OpenFreeMap vector tiles and 3D buildings
- Terrain relief from raster DEM tiles
- A rudimentary Three.js airplane rendered as a custom MapLibre layer
- Autopilot orbit mode plus manual keyboard override
- Fastlane-driven verification for the GitHub Pages publish workflow

## Controls

- `W` / `ArrowUp`: pitch up
- `S` / `ArrowDown`: pitch down
- `A` / `ArrowLeft`: bank left
- `D` / `ArrowRight`: bank right
- `Q` / `E`: throttle down / up
- `M`: toggle autopilot/manual
- `C`: toggle chase/free camera
- `R`: reset position
- `Space`: pause or resume

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
