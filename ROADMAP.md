# Roadmap

This project is being developed as an arcade-first flight game with cinematic presentation and sim-lite handling.

## Product Shape

| Pillar | Purpose | What it means in practice |
| --- | --- | --- |
| Arcade core | Make every run short, readable, and replayable | Checkpoints, medals, score, crash/reset, quick restart, route completion screen |
| Cinematic layer | Make the flyover feel distinctive even when the player is not optimizing score | Camera presets, replay mode, scenic intros, landmark beats, photo moments |
| Sim-lite handling | Add mastery without turning the app into a full simulator | Stall onset, energy loss in turns, wind drift, terrain danger, warning HUD |
| Mobile-first PWA | Keep the app usable as an installable touch experience | Thumb controls, fast resume, stable frame pacing, install/offline polish |

## Release Plan

| Version | Goal | Must ship | Explicitly not yet |
| --- | --- | --- | --- |
| `v0.2` | Turn the demo into a real arcade run | Crash/reset state, bronze/silver/gold medals, route completion screen, stronger touch controls, checkpoint score tuning | Replay mode, wind, photo mode |
| `v0.3` | Add cinematic identity | Camera damping, replay capture, flyby/orbit cameras, scenic route intro, photo mode | Backend sharing, advanced weather |
| `v0.4` | Add sim-lite depth | Stall behavior, overspeed and low-speed cues, wind drift, terrain warnings, better energy model | Full cockpit sim, complex aircraft systems |
| `v0.5` | Turn systems into a repeatable product loop | Mission selector, difficulty presets, ghost replay, daily seeded challenge, route packs | Multiplayer, UGC editor |
| `v1.0` | Ship a polished installable game | 3 to 5 route packs, balanced physics, polished mobile UX, stable replay flow, accessibility/settings pass | Large online platform scope |

## Current Repo Workstreams

| Workstream | Goal | Current files | Likely new files | Next concrete change |
| --- | --- | --- | --- | --- |
| Flight model | Keep controls forgiving while adding consequences | `src/lib/flightSimulation.ts` | `src/lib/flightWarnings.ts` | Add stall thresholds, overspeed penalties, and crash conditions |
| Mission/game loop | Turn checkpoint flying into a complete run lifecycle | `src/components/FlightExperience.tsx` | `src/lib/gameState.ts`, `src/components/RunSummary.tsx` | Add medal scoring, finish state, restart flow, and combo/bonus rules |
| Route content | Support scenic routes and challenge packs | `src/lib/flightPlan.ts` | `src/lib/routes.ts`, `src/lib/missions.ts` | Split route data from sampling logic and add more than one route |
| Cameras/replay | Make runs feel cinematic and reviewable | `src/components/FlightExperience.tsx` | `src/lib/cameraRig.ts`, `src/lib/replayRecorder.ts`, `src/components/ReplayHud.tsx` | Replace direct `jumpTo` updates with damped chase/orbit cameras |
| UI/HUD | Keep the game readable on desktop and mobile | `src/components/FlightExperience.tsx`, `src/components/FlightExperience.css`, `src/App.tsx`, `src/App.css` | `src/components/HudPanel.tsx`, `src/components/TouchControls.tsx` | Split the scene component into focused UI pieces before adding more states |
| PWA/performance | Keep installability and frame pacing intact as scope grows | `src/pwa.ts`, `vite.config.ts`, `package.json` | `src/lib/lazyScene.ts` | Lazy-load heavier map/game code after shell render and add smoke tests |
| Content/polish | Keep the public surface aligned with the shipped experience | `README.md`, `public/plane-icon.svg` | `public/screenshots/*` | Add screenshots/GIFs once replay/photo mode lands |

## Ordered Backlog

| ID | Priority | Outcome | Files most affected | Done when |
| --- | --- | --- | --- | --- |
| A1 | `P0` | Runs end with a clear success/fail result instead of endless free flight | `src/components/FlightExperience.tsx`, `src/lib/flightSimulation.ts` | Player can crash, finish, and restart without refreshing |
| A2 | `P0` | Medal scoring makes the checkpoint loop legible and replayable | `src/components/FlightExperience.tsx`, `src/lib/gameState.ts` | Each route shows bronze/silver/gold targets and awards one on finish |
| A3 | `P0` | Touch controls feel intentional on phones and tablets | `src/components/FlightExperience.tsx`, `src/components/FlightExperience.css` | Two-thumb play works without accidental map interaction |
| A4 | `P0` | Cameras stop feeling mechanical | `src/components/FlightExperience.tsx`, `src/lib/cameraRig.ts` | Chase camera uses damping and one alternate cinematic preset exists |
| A5 | `P1` | The app supports multiple routes instead of one hardcoded loop | `src/lib/flightPlan.ts`, `src/lib/routes.ts`, `src/lib/missions.ts` | At least three selectable routes exist with distinct checkpoint layouts |
| A6 | `P1` | Replay mode turns finished runs into a showcase feature | `src/lib/replayRecorder.ts`, `src/components/ReplayHud.tsx` | A finished run can be replayed from at least two cameras |
| A7 | `P1` | Sim-lite depth rewards cleaner flying | `src/lib/flightSimulation.ts`, `src/lib/flightWarnings.ts` | Stall and terrain warnings affect scoring or failure states |
| A8 | `P1` | Mission selection creates a real front door for the game | `src/App.tsx`, `src/App.css`, `src/lib/missions.ts` | Player chooses route + difficulty before entering the scene |
| A9 | `P2` | Daily challenge/ghost systems create repeat engagement | `src/lib/missions.ts`, `src/lib/replayRecorder.ts` | A seeded daily route and local ghost replay both work |
| A10 | `P2` | Performance stays healthy as features grow | `vite.config.ts`, `src/main.tsx`, `src/pwa.ts` | The game loads fast enough on mid-range mobile hardware |

## Recommended PR Sequence

| PR | Scope | Why this order |
| --- | --- | --- |
| `PR-1` | Crash/reset state, finish state, medal thresholds | Completes the arcade loop before adding presentation work |
| `PR-2` | Split HUD and touch controls into dedicated components | Reduces risk before replay/camera/state complexity grows |
| `PR-3` | Camera damping plus one cinematic camera preset | Gives immediate visible payoff without changing route content |
| `PR-4` | Multi-route data model and mission selector shell | Opens the path to route packs and daily challenges |
| `PR-5` | Replay recorder and replay HUD | Turns finished runs into a showcase and sharing surface |
| `PR-6` | Stall, wind, terrain danger, warning HUD | Adds sim-lite mastery after the core loop is stable |

## Definition of Success

| Layer | Success test |
| --- | --- |
| Arcade | A new player can finish a short route, understand the score, and immediately want another run |
| Cinematic | A finished run looks worth replaying or screen recording |
| Sim-lite | A skilled player can feel the difference between efficient and sloppy flying |
| Mobile/PWA | The game is playable with touch controls and installable without friction |
