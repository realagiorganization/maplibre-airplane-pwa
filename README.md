# MapLibre Airplane PWA

An installable React + Vite progressive web app that stages a lightweight
flight experience over an open MapLibre scene.

## What is here

- A polished landing section with an aviation-oriented visual language
- A `FlightExperience` scene that animates a small flight loop over a live map
- PWA registration via `vite-plugin-pwa`
- A build surface that is small enough to publish quickly through GitHub Pages

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The current implementation is intentionally modest: it proves the interaction
surface, map bootstrapping, and deployment path before a heavier simulator
stack is added.
