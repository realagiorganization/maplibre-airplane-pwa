import type { FeatureCollection, Point, Position } from 'geojson'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import maplibregl, { NavigationControl } from 'maplibre-gl'
import {
  startTransition,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { AirplaneLayer } from '../lib/airplaneLayer'
import {
  createTrailFeature,
  flightCenter,
  flightRouteFeature,
} from '../lib/flightPlan'
import {
  createManualFlightFrame,
  sampleAutopilotFrame,
  stepManualFlight,
  type FlightInputs,
  type PilotMode,
  type SimFrame,
} from '../lib/flightSimulation'
import './FlightExperience.css'

const OPEN_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const TERRAIN_SOURCE_URL = 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'
const ROUTE_SOURCE_ID = 'flight-route'
const TRAIL_SOURCE_ID = 'flight-trail'
const CHECKPOINT_SOURCE_ID = 'flight-checkpoints'
const CHECKPOINT_COUNT = 6
const CHECKPOINT_CAPTURE_METERS = 520
const TOUCH_INPUTS = ['w', 'a', 's', 'd', 'q', 'e'] as const
const CONTROL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'w',
  'a',
  's',
  'd',
  'q',
  'e',
  'm',
  'r',
  'c',
  ' ',
])

interface FlightCheckpoint {
  coordinates: [number, number]
  label: string
}

interface GameState {
  activeCheckpointIndex: number
  bestLapMs: number | null
  distanceToCheckpointMeters: number | null
  laps: number
  lapStartedAtMs: number | null
  runStartedAtMs: number | null
  score: number
}

interface TelemetryState {
  clearanceFeet: number | null
  frame: SimFrame
  game: GameState
  runElapsedMs: number | null
}

type TouchInput = (typeof TOUCH_INPUTS)[number]

type Controller = {
  followCamera: boolean
  frame: SimFrame
  game: GameState
  lastTickMs: number
  map: Map
  mode: PilotMode
  pauseStartedAt: number | null
  paused: boolean
  rafId: number | null
  simulationStartedAt: number
  tick: (timestamp: number) => void
  timeOffsetMs: number
}

const flightCheckpoints = buildCheckpoints()
const initialFrame = sampleAutopilotFrame(0)
const initialGame = createPreviewGameState(initialFrame)

export function FlightExperience() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<Controller | null>(null)
  const activeInputsRef = useRef<Set<string>>(new Set())
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    clearanceFeet: null,
    frame: initialFrame,
    game: initialGame,
    runElapsedMs: null,
  })
  const [cameraMode, setCameraMode] = useState<'chase' | 'free'>('chase')
  const [isPaused, setIsPaused] = useState(false)
  const [pilotMode, setPilotMode] = useState<PilotMode>('autopilot')
  const [activeTouchInputs, setActiveTouchInputs] = useState<TouchInput[]>([])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const map = new maplibregl.Map({
      center: flightCenter as [number, number],
      container: containerRef.current,
      maxPitch: 85,
      pitch: 76,
      style: OPEN_MAP_STYLE,
      zoom: 13.7,
      canvasContextAttributes: { antialias: true },
    })

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')

    const controller: Controller = {
      followCamera: true,
      frame: initialFrame,
      game: initialGame,
      lastTickMs: performance.now(),
      map,
      mode: 'autopilot',
      pauseStartedAt: null,
      paused: false,
      rafId: null,
      simulationStartedAt: performance.now(),
      tick: () => {},
      timeOffsetMs: 0,
    }

    controllerRef.current = controller

    map.on('load', () => {
      configureMap(map)
      syncMapInteractions(map, true)
      updateCheckpointSource(map, controller.game)

      controller.tick = (timestamp: number) => {
        if (controller.paused) {
          controller.rafId = null
          return
        }

        const elapsedMs =
          timestamp - controller.simulationStartedAt - controller.timeOffsetMs
        const deltaSeconds = (timestamp - controller.lastTickMs) / 1000
        controller.lastTickMs = timestamp

        const inputs = readInputs(activeInputsRef.current)
        let nextFrame: SimFrame
        if (controller.mode === 'manual') {
          const terrainMeters =
            map.queryTerrainElevation([controller.frame.lng, controller.frame.lat]) ??
            null
          nextFrame = stepManualFlight(
            controller.frame,
            inputs,
            deltaSeconds,
            terrainMeters,
          )
          controller.game = updateGameState(controller.game, nextFrame, timestamp)
        } else {
          nextFrame = sampleAutopilotFrame(elapsedMs)
          controller.game = createPreviewGameState(nextFrame)
        }

        controller.frame = nextFrame
        updateTrail(map, nextFrame.trailCoordinates)
        updateCheckpointSource(map, controller.game)
        if (controller.followCamera) {
          updateChaseCamera(map, nextFrame)
        }

        startTransition(() => {
          setTelemetry(buildTelemetryState(map, nextFrame, controller.game, timestamp))
        })

        controller.rafId = requestAnimationFrame(controller.tick)
      }

      map.addLayer(new AirplaneLayer(() => controller.frame))
      updateTrail(map, initialFrame.trailCoordinates)
      updateCheckpointSource(map, controller.game)
      updateChaseCamera(map, initialFrame)
      setTelemetry(
        buildTelemetryState(map, initialFrame, controller.game, performance.now()),
      )
      controller.rafId = requestAnimationFrame(controller.tick)
    })

    return () => {
      if (controller.rafId !== null) {
        cancelAnimationFrame(controller.rafId)
      }

      map.remove()
      controllerRef.current = null
    }
  }, [])

  function syncTouchInputsState() {
    setActiveTouchInputs(
      TOUCH_INPUTS.filter((input) => activeInputsRef.current.has(input)),
    )
  }

  function togglePause() {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    if (controller.paused) {
      if (controller.pauseStartedAt !== null) {
        controller.timeOffsetMs += performance.now() - controller.pauseStartedAt
      }
      controller.paused = false
      controller.pauseStartedAt = null
      controller.lastTickMs = performance.now()
      controller.rafId = requestAnimationFrame(controller.tick)
      setIsPaused(false)
      return
    }

    controller.paused = true
    controller.pauseStartedAt = performance.now()
    if (controller.rafId !== null) {
      cancelAnimationFrame(controller.rafId)
      controller.rafId = null
    }
    setIsPaused(true)
  }

  function toggleCameraMode() {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    controller.followCamera = !controller.followCamera
    syncMapInteractions(controller.map, controller.followCamera)
    setCameraMode(controller.followCamera ? 'chase' : 'free')

    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
  }

  function armManualMode() {
    const controller = controllerRef.current
    if (!controller || controller.mode === 'manual') {
      return
    }

    const now = performance.now()
    controller.mode = 'manual'
    controller.frame = createManualFlightFrame(controller.frame)
    controller.game = createManualGameState(controller.frame, now)
    controller.lastTickMs = now
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, controller.game)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
    setPilotMode('manual')
  }

  function togglePilotMode() {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    if (controller.mode === 'manual') {
      const now = performance.now()
      controller.mode = 'autopilot'
      controller.frame = sampleAutopilotFrame(
        now - controller.simulationStartedAt - controller.timeOffsetMs,
      )
      controller.game = createPreviewGameState(controller.frame)
      activeInputsRef.current.clear()
      syncTouchInputsState()
      updateTrail(controller.map, controller.frame.trailCoordinates)
      updateCheckpointSource(controller.map, controller.game)
      if (controller.followCamera) {
        updateChaseCamera(controller.map, controller.frame)
      }
      setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
      setPilotMode('autopilot')
      return
    }

    armManualMode()
  }

  function resetFlight() {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    const now = performance.now()
    const resetFrame = sampleAutopilotFrame(0)
    controller.frame =
      controller.mode === 'manual'
        ? createManualFlightFrame(resetFrame)
        : resetFrame
    controller.game =
      controller.mode === 'manual'
        ? createManualGameState(controller.frame, now)
        : createPreviewGameState(controller.frame)
    controller.lastTickMs = now
    activeInputsRef.current.clear()
    syncTouchInputsState()
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, controller.game)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
  }

  function setTouchControl(control: TouchInput, active: boolean) {
    if (active) {
      activeInputsRef.current.add(control)
      if (controllerRef.current?.mode === 'autopilot') {
        armManualMode()
      }
    } else {
      activeInputsRef.current.delete(control)
    }
    syncTouchInputsState()
  }

  const handleKeyboardControl = useEffectEvent((key: string, active: boolean) => {
    if (active) {
      if (key === ' ') {
        togglePause()
        return
      }
      if (key === 'c') {
        toggleCameraMode()
        return
      }
      if (key === 'm') {
        togglePilotMode()
        return
      }
      if (key === 'r') {
        resetFlight()
        return
      }

      activeInputsRef.current.add(key)
      if (controllerRef.current?.mode === 'autopilot') {
        armManualMode()
      }
      syncTouchInputsState()
      return
    }

    if (activeInputsRef.current.delete(key)) {
      syncTouchInputsState()
    }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key)
      if (!CONTROL_KEYS.has(key)) {
        return
      }

      event.preventDefault()
      handleKeyboardControl(key, true)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key)
      if (!CONTROL_KEYS.has(key)) {
        return
      }

      event.preventDefault()
      handleKeyboardControl(key, false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const activeCheckpoint = flightCheckpoints[telemetry.game.activeCheckpointIndex]

  return (
    <section className="experience-shell">
      <div className="map-stage">
        <div ref={containerRef} className="map-canvas" />

        <div className="touch-deck" aria-label="Touch flight controls">
          <div className="touch-pad">
            <TouchButton
              active={activeTouchInputs.includes('w')}
              label="Pitch +"
              onActiveChange={setTouchControl}
              value="w"
            />
            <div className="touch-row">
              <TouchButton
                active={activeTouchInputs.includes('a')}
                label="Bank L"
                onActiveChange={setTouchControl}
                value="a"
              />
              <TouchButton
                active={activeTouchInputs.includes('s')}
                label="Pitch -"
                onActiveChange={setTouchControl}
                value="s"
              />
              <TouchButton
                active={activeTouchInputs.includes('d')}
                label="Bank R"
                onActiveChange={setTouchControl}
                value="d"
              />
            </div>
          </div>

          <div className="touch-throttle">
            <TouchButton
              active={activeTouchInputs.includes('e')}
              label="Throttle +"
              onActiveChange={setTouchControl}
              value="e"
            />
            <TouchButton
              active={activeTouchInputs.includes('q')}
              label="Throttle -"
              onActiveChange={setTouchControl}
              value="q"
            />
          </div>
        </div>

        <div className="hud-panel">
          <div className="status-row">
            <span className="status-chip accent">MapLibre + OpenFreeMap</span>
            <span className="status-chip">
              {pilotMode === 'manual' ? 'Manual controls armed' : 'Autopilot orbit'}
            </span>
            <span className="status-chip">
              {cameraMode === 'chase' ? 'Chase camera' : 'Free camera'}
            </span>
            <span className="status-chip">
              {isPaused ? 'Simulation paused' : 'Simulation live'}
            </span>
          </div>

          <div className="telemetry-grid">
            <TelemetryCard
              label="Speed"
              value={`${Math.round(telemetry.frame.speedKts)} kt`}
            />
            <TelemetryCard
              label="Altitude"
              value={`${Math.round(telemetry.frame.altitudeFeet).toLocaleString()} ft`}
            />
            <TelemetryCard
              label="Heading"
              value={`${Math.round(telemetry.frame.headingDegrees)
                .toString()
                .padStart(3, '0')}°`}
            />
            <TelemetryCard
              label={pilotMode === 'manual' ? 'Throttle' : 'Loop'}
              value={
                pilotMode === 'manual'
                  ? `${Math.round(telemetry.frame.throttlePercent)}%`
                  : `${Math.round(telemetry.frame.loopPercent)}%`
              }
            />
            <TelemetryCard
              label="Bank"
              value={`${Math.round((telemetry.frame.bankRadians * 180) / Math.PI)}°`}
            />
            <TelemetryCard
              label="Clearance"
              value={
                telemetry.clearanceFeet === null
                  ? 'Terrain n/a'
                  : `${Math.round(telemetry.clearanceFeet).toLocaleString()} ft`
              }
            />
          </div>

          <div className="control-row">
            <button className="control-button accent" onClick={togglePilotMode}>
              {pilotMode === 'manual' ? 'Return to autopilot' : 'Take manual control'}
            </button>
            <button className="control-button" onClick={toggleCameraMode}>
              {cameraMode === 'chase' ? 'Switch to free camera' : 'Return to chase'}
            </button>
            <button className="control-button" onClick={togglePause}>
              {isPaused ? 'Resume flight' : 'Pause flight'}
            </button>
            <button className="control-button" onClick={resetFlight}>
              Reset position
            </button>
          </div>

          <div className="mission-grid">
            <MissionCard
              label="Score"
              title={telemetry.game.score.toLocaleString()}
              subtitle={pilotMode === 'manual' ? 'Checkpoint bonuses live' : 'Arm manual mode'}
            />
            <MissionCard
              label="Laps"
              title={telemetry.game.laps.toString()}
              subtitle={
                telemetry.game.bestLapMs === null
                  ? 'No completed lap yet'
                  : `Best ${formatDuration(telemetry.game.bestLapMs)}`
              }
            />
            <MissionCard
              label="Next Checkpoint"
              title={activeCheckpoint.label}
              subtitle={formatDistance(telemetry.game.distanceToCheckpointMeters)}
            />
            <MissionCard
              label="Run Time"
              title={
                telemetry.runElapsedMs === null
                  ? 'Standby'
                  : formatDuration(telemetry.runElapsedMs)
              }
              subtitle={
                pilotMode === 'manual'
                  ? 'Timer runs in manual mode'
                  : 'Autopilot preview active'
              }
            />
          </div>

          <div className="controls-grid">
            <article className="controls-card">
              <p className="controls-label">Keyboard</p>
              <ul>
                <li>`W` / `ArrowUp`: pitch up</li>
                <li>`S` / `ArrowDown`: pitch down</li>
                <li>`A` / `ArrowLeft`: bank left</li>
                <li>`D` / `ArrowRight`: bank right</li>
                <li>`Q` / `E`: throttle down / up</li>
              </ul>
            </article>

            <article className="controls-card">
              <p className="controls-label">Touch + mode</p>
              <ul>
                <li>Bottom deck mirrors pitch, bank, and throttle</li>
                <li>`M`: toggle autopilot/manual</li>
                <li>`C`: toggle chase camera</li>
                <li>`R`: reset position</li>
                <li>`Space`: pause or resume</li>
              </ul>
            </article>
          </div>
        </div>
      </div>

      <div className="detail-row">
        <article className="detail-card">
          <p className="detail-label">Aircraft</p>
          <h2>Three.js custom layer</h2>
          <p>
            The airplane is a deliberately blunt 3D mesh rendered inside MapLibre&apos;s
            WebGL context instead of a flat sprite marker.
          </p>
        </article>

        <article className="detail-card">
          <p className="detail-label">Map stack</p>
          <h2>Open-source Google Maps analogue</h2>
          <p>
            OpenFreeMap supplies the vector basemap and extruded buildings while
            MapLibre terrain adds relief for a proper flyover scene.
          </p>
        </article>

        <article className="detail-card">
          <p className="detail-label">Game loop</p>
          <h2>Checkpoint scoring run</h2>
          <p>
            Manual mode now tracks checkpoint captures, lap count, run timer, and a
            best-lap readout so the flight toy behaves more like a compact route game.
          </p>
        </article>
      </div>
    </section>
  )
}

function TelemetryCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <article className="telemetry-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function MissionCard({
  label,
  subtitle,
  title,
}: {
  label: string
  subtitle: string
  title: string
}) {
  return (
    <article className="mission-card">
      <p>{label}</p>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </article>
  )
}

function TouchButton({
  active,
  label,
  onActiveChange,
  value,
}: {
  active: boolean
  label: string
  onActiveChange: (control: TouchInput, active: boolean) => void
  value: TouchInput
}) {
  function activate(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onActiveChange(value, true)
  }

  function deactivate() {
    onActiveChange(value, false)
  }

  return (
    <button
      type="button"
      className={`touch-button${active ? ' is-active' : ''}`}
      onPointerCancel={deactivate}
      onPointerDown={activate}
      onPointerLeave={deactivate}
      onPointerUp={deactivate}
    >
      {label}
    </button>
  )
}

function configureMap(map: Map) {
  if (!map.getSource('terrain-source')) {
    map.addSource('terrain-source', {
      type: 'raster-dem',
      url: TERRAIN_SOURCE_URL,
      tileSize: 256,
    })
  }

  map.setTerrain({
    exaggeration: 1.3,
    source: 'terrain-source',
  })

  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: flightRouteFeature,
    })
  }

  if (!map.getSource(TRAIL_SOURCE_ID)) {
    map.addSource(TRAIL_SOURCE_ID, {
      type: 'geojson',
      data: createTrailFeature(initialFrame.trailCoordinates),
    })
  }

  if (!map.getSource(CHECKPOINT_SOURCE_ID)) {
    map.addSource(CHECKPOINT_SOURCE_ID, {
      type: 'geojson',
      data: buildCheckpointFeatureCollection(initialGame.activeCheckpointIndex),
    })
  }

  if (map.getLayer('building-3d')) {
    map.setPaintProperty('building-3d', 'fill-extrusion-color', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'render_height'], 0],
      0,
      '#123d4a',
      60,
      '#175868',
      180,
      '#78b7c0',
      360,
      '#f7d093',
    ])
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.94)
  }

  if (!map.getLayer('terrain-hillshade')) {
    map.addLayer(
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'terrain-source',
        paint: {
          'hillshade-accent-color': '#f9a953',
          'hillshade-highlight-color': '#e9f6fb',
          'hillshade-shadow-color': '#081d28',
        },
      },
      'building',
    )
  }

  if (!map.getLayer('flight-route-glow')) {
    map.addLayer(
      {
        id: 'flight-route-glow',
        type: 'line',
        source: ROUTE_SOURCE_ID,
        paint: {
          'line-blur': 2,
          'line-color': '#79dbe6',
          'line-opacity': 0.34,
          'line-width': 6,
        },
      },
      'building-3d',
    )
  }

  if (!map.getLayer('flight-route-base')) {
    map.addLayer(
      {
        id: 'flight-route-base',
        type: 'line',
        source: ROUTE_SOURCE_ID,
        paint: {
          'line-color': '#fef3d6',
          'line-dasharray': [1.25, 1.1],
          'line-opacity': 0.86,
          'line-width': 1.6,
        },
      },
      'building-3d',
    )
  }

  if (!map.getLayer('flight-trail')) {
    map.addLayer(
      {
        id: 'flight-trail',
        type: 'line',
        source: TRAIL_SOURCE_ID,
        paint: {
          'line-blur': 1.1,
          'line-color': '#ef8d32',
          'line-width': 4.1,
        },
      },
      'building-3d',
    )
  }

  if (!map.getLayer('flight-checkpoints')) {
    map.addLayer(
      {
        id: 'flight-checkpoints',
        type: 'circle',
        source: CHECKPOINT_SOURCE_ID,
        paint: {
          'circle-color': ['case', ['==', ['get', 'active'], 1], '#ffd073', '#103441'],
          'circle-radius': ['case', ['==', ['get', 'active'], 1], 8, 5],
          'circle-stroke-color': '#07141c',
          'circle-stroke-width': 2,
        },
      },
      'building-3d',
    )
  }

  if (!map.getLayer('flight-checkpoint-labels')) {
    map.addLayer(
      {
        id: 'flight-checkpoint-labels',
        type: 'symbol',
        source: CHECKPOINT_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-offset': [0, 1.2],
          'text-size': 11,
        },
        paint: {
          'text-color': '#fef3d6',
          'text-halo-blur': 0.6,
          'text-halo-color': '#07141c',
          'text-halo-width': 1.1,
        },
      },
      'building-3d',
    )
  }
}

function updateTrail(map: Map, trailCoordinates: Position[]) {
  const trailSource = map.getSource(TRAIL_SOURCE_ID) as GeoJSONSource | undefined
  if (!trailSource) {
    return
  }

  trailSource.setData(createTrailFeature(trailCoordinates))
}

function updateCheckpointSource(map: Map, game: GameState) {
  const checkpointSource = map.getSource(CHECKPOINT_SOURCE_ID) as
    | GeoJSONSource
    | undefined
  if (!checkpointSource) {
    return
  }

  checkpointSource.setData(buildCheckpointFeatureCollection(game.activeCheckpointIndex))
}

function updateChaseCamera(map: Map, frame: SimFrame) {
  map.jumpTo({
    bearing: frame.headingDegrees,
    center: [frame.lng, frame.lat],
    padding: {
      bottom: 240,
      left: 32,
      right: 32,
      top: 64,
    },
    pitch: 78,
    zoom: frame.mode === 'manual' ? 14.35 : 14.1,
  })
}

function syncMapInteractions(map: Map, followCamera: boolean) {
  const methods = [
    map.boxZoom,
    map.doubleClickZoom,
    map.dragPan,
    map.dragRotate,
    map.keyboard,
    map.scrollZoom,
    map.touchPitch,
    map.touchZoomRotate,
  ]

  for (const method of methods) {
    if (followCamera) {
      method.disable()
    } else {
      method.enable()
    }
  }
}

function readInputs(keys: Set<string>): FlightInputs {
  return {
    pitch:
      valueForKey(keys, 'w', 'ArrowUp') - valueForKey(keys, 's', 'ArrowDown'),
    roll:
      valueForKey(keys, 'd', 'ArrowRight') - valueForKey(keys, 'a', 'ArrowLeft'),
    throttle: valueForKey(keys, 'e') - valueForKey(keys, 'q'),
  }
}

function valueForKey(keys: Set<string>, ...options: string[]): number {
  return options.some((option) => keys.has(option)) ? 1 : 0
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

function buildTelemetryState(
  map: Map,
  frame: SimFrame,
  game: GameState,
  now: number,
): TelemetryState {
  const terrainMeters = map.queryTerrainElevation([frame.lng, frame.lat]) ?? null

  return {
    clearanceFeet:
      terrainMeters === null ? null : (frame.altitudeMeters - terrainMeters) * 3.28084,
    frame,
    game,
    runElapsedMs: game.runStartedAtMs === null ? null : now - game.runStartedAtMs,
  }
}

function buildCheckpoints(): FlightCheckpoint[] {
  const routeCoordinates = flightRouteFeature.geometry.coordinates

  return Array.from({ length: CHECKPOINT_COUNT }, (_, index) => {
    const routeIndex = Math.floor((index * routeCoordinates.length) / CHECKPOINT_COUNT)
    const [lng, lat] = routeCoordinates[routeIndex]

    return {
      coordinates: [lng, lat],
      label: `CP-${index + 1}`,
    }
  })
}

function createPreviewGameState(frame: SimFrame): GameState {
  const nearest = findNearestCheckpoint([frame.lng, frame.lat])

  return {
    activeCheckpointIndex: nearest.index,
    bestLapMs: null,
    distanceToCheckpointMeters: nearest.distanceMeters,
    laps: 0,
    lapStartedAtMs: null,
    runStartedAtMs: null,
    score: 0,
  }
}

function createManualGameState(frame: SimFrame, now: number): GameState {
  const nearest = findNearestCheckpoint([frame.lng, frame.lat])
  const activeCheckpointIndex =
    nearest.distanceMeters < CHECKPOINT_CAPTURE_METERS
      ? (nearest.index + 1) % flightCheckpoints.length
      : nearest.index

  return {
    activeCheckpointIndex,
    bestLapMs: null,
    distanceToCheckpointMeters: distanceToCheckpoint(
      [frame.lng, frame.lat],
      activeCheckpointIndex,
    ),
    laps: 0,
    lapStartedAtMs: now,
    runStartedAtMs: now,
    score: 0,
  }
}

function updateGameState(game: GameState, frame: SimFrame, now: number): GameState {
  const distanceMeters = distanceToCheckpoint(
    [frame.lng, frame.lat],
    game.activeCheckpointIndex,
  )

  if (game.runStartedAtMs === null || distanceMeters > CHECKPOINT_CAPTURE_METERS) {
    return {
      ...game,
      distanceToCheckpointMeters: distanceMeters,
    }
  }

  const nextCheckpointIndex =
    (game.activeCheckpointIndex + 1) % flightCheckpoints.length
  const completedLap = nextCheckpointIndex === 0
  const lapStartedAtMs = game.lapStartedAtMs ?? now
  const lapTimeMs = completedLap ? now - lapStartedAtMs : null

  return {
    activeCheckpointIndex: nextCheckpointIndex,
    bestLapMs:
      lapTimeMs === null
        ? game.bestLapMs
        : game.bestLapMs === null
          ? lapTimeMs
          : Math.min(game.bestLapMs, lapTimeMs),
    distanceToCheckpointMeters: distanceToCheckpoint(
      [frame.lng, frame.lat],
      nextCheckpointIndex,
    ),
    laps: game.laps + (completedLap ? 1 : 0),
    lapStartedAtMs: completedLap ? now : lapStartedAtMs,
    runStartedAtMs: game.runStartedAtMs,
    score: game.score + 100 + (completedLap ? 250 : 0),
  }
}

function buildCheckpointFeatureCollection(
  activeCheckpointIndex: number,
): FeatureCollection<Point, { active: number; label: string }> {
  return {
    type: 'FeatureCollection',
    features: flightCheckpoints.map((checkpoint, index) => ({
      type: 'Feature',
      properties: {
        active: index === activeCheckpointIndex ? 1 : 0,
        label: checkpoint.label,
      },
      geometry: {
        type: 'Point',
        coordinates: checkpoint.coordinates,
      },
    })),
  }
}

function findNearestCheckpoint(point: [number, number]) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < flightCheckpoints.length; index += 1) {
    const distance = distanceToCheckpoint(point, index)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return {
    distanceMeters: bestDistance,
    index: bestIndex,
  }
}

function distanceToCheckpoint(point: [number, number], checkpointIndex: number) {
  const checkpoint = flightCheckpoints[checkpointIndex]
  return distanceMeters(
    point[0],
    point[1],
    checkpoint.coordinates[0],
    checkpoint.coordinates[1],
  )
}

function distanceMeters(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
): number {
  const deltaLongitudeMeters =
    (endLng - startLng) *
    111_320 *
    Math.cos((((startLat + endLat) / 2) * Math.PI) / 180)
  const deltaLatitudeMeters = (endLat - startLat) * 110_574

  return Math.hypot(deltaLongitudeMeters, deltaLatitudeMeters)
}

function formatDistance(distanceMeters: number | null): string {
  if (distanceMeters === null) {
    return 'Standby'
  }

  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km out`
  }

  return `${Math.round(distanceMeters)} m out`
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
