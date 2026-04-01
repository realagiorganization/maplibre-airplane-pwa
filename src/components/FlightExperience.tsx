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
  isTerrainStrike,
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
const CHECKPOINT_SCORE = 100
const FINISH_SCORE_BONUS = 450
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
const MEDAL_TARGETS_MS: Record<MedalTier, number> = {
  bronze: 132_000,
  gold: 102_000,
  silver: 116_000,
}
const MEDAL_SCORE_BONUS: Record<MedalTier, number> = {
  bronze: 250,
  gold: 900,
  silver: 550,
}

interface FlightCheckpoint {
  coordinates: [number, number]
  label: string
}

type MedalTier = 'bronze' | 'gold' | 'silver'

type RunStatus = 'crashed' | 'finished' | 'preview' | 'running'

interface GameState {
  activeCheckpointIndex: number
  checkpointCaptures: number
  distanceToCheckpointMeters: number | null
  finishTimeMs: number | null
  medalTier: MedalTier | null
  runStartedAtMs: number | null
  score: number
  status: RunStatus
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

  function syncTouchInputsState() {
    setActiveTouchInputs(
      TOUCH_INPUTS.filter((input) => activeInputsRef.current.has(input)),
    )
  }

  function clearInputs() {
    activeInputsRef.current.clear()
    syncTouchInputsState()
  }

  function resumeLoop(controller: Controller, now: number) {
    controller.paused = false
    controller.pauseStartedAt = null
    controller.lastTickMs = now
    if (controller.rafId === null) {
      controller.rafId = requestAnimationFrame(controller.tick)
    }
    setIsPaused(false)
  }

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
        let nextGame: GameState

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
          const nextTerrainMeters =
            map.queryTerrainElevation([nextFrame.lng, nextFrame.lat]) ?? terrainMeters
          nextGame = updateGameState(
            controller.game,
            nextFrame,
            nextTerrainMeters,
            timestamp,
          )
        } else {
          nextFrame = sampleAutopilotFrame(elapsedMs)
          nextGame = createPreviewGameState(nextFrame)
        }

        controller.frame = nextFrame
        controller.game = nextGame
        updateTrail(map, nextFrame.trailCoordinates)
        updateCheckpointSource(map, nextGame)
        if (controller.followCamera) {
          updateChaseCamera(map, nextFrame)
        }

        startTransition(() => {
          setTelemetry(buildTelemetryState(map, nextFrame, nextGame, timestamp))
        })

        if (controller.mode === 'manual' && isTerminalGame(nextGame)) {
          activeInputsRef.current.clear()
          syncTouchInputsState()
          controller.rafId = null
          return
        }

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
  function togglePause() {
    const controller = controllerRef.current
    if (!controller || isTerminalGame(controller.game)) {
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
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, controller.game)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
    resumeLoop(controller, now)
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
      clearInputs()
      updateTrail(controller.map, controller.frame.trailCoordinates)
      updateCheckpointSource(controller.map, controller.game)
      if (controller.followCamera) {
        updateChaseCamera(controller.map, controller.frame)
      }
      setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
      resumeLoop(controller, now)
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
    clearInputs()
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, controller.game)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame, controller.game, now))
    resumeLoop(controller, now)
  }

  function setTouchControl(control: TouchInput, active: boolean) {
    const controller = controllerRef.current
    if (active) {
      if (controller?.mode === 'manual' && isTerminalGame(controller.game)) {
        return
      }
      activeInputsRef.current.add(control)
      if (controller?.mode === 'autopilot') {
        armManualMode()
      }
    } else {
      activeInputsRef.current.delete(control)
    }
    syncTouchInputsState()
  }

  const handleKeyboardControl = useEffectEvent((key: string, active: boolean) => {
    const controller = controllerRef.current
    const terminalManualRun =
      controller?.mode === 'manual' && isTerminalGame(controller.game)

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
      if (terminalManualRun) {
        return
      }

      activeInputsRef.current.add(key)
      if (controller?.mode === 'autopilot') {
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
  const runFinished = isTerminalGame(telemetry.game)
  const statusChipClass =
    telemetry.game.status === 'finished'
      ? ' is-success'
      : telemetry.game.status === 'crashed'
        ? ' is-danger'
        : ''

  return (
    <section className="experience-shell">
      <div className="map-stage">
        <div ref={containerRef} className="map-canvas" />

        {pilotMode === 'manual' && runFinished ? (
          <div className="run-result-shell">
            <div
              className={`run-result ${
                telemetry.game.status === 'finished' ? 'is-finished' : 'is-crashed'
              }`}
            >
              <p className="run-result-label">{getResultEyebrow(telemetry.game)}</p>
              <h2>{getResultTitle(telemetry.game)}</h2>
              <p className="run-result-body">{getResultBody(telemetry.game)}</p>
              <div className="run-result-actions">
                <button className="control-button accent" onClick={resetFlight}>
                  Fly again
                </button>
                <button className="control-button" onClick={togglePilotMode}>
                  Return to autopilot
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
            <span className={`status-chip${statusChipClass}`}>
              {pilotMode === 'manual'
                ? formatRunStatusChip(telemetry.game.status)
                : 'Autopilot orbit'}
            </span>
            <span className="status-chip">
              {cameraMode === 'chase' ? 'Chase camera' : 'Free camera'}
            </span>
            <span
              className={`status-chip${
                isPaused && !runFinished ? ' is-warning' : ''
              }`}
            >
              {runFinished
                ? 'Press R to restart'
                : isPaused
                  ? 'Simulation paused'
                  : 'Simulation live'}
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
            <button
              className="control-button"
              disabled={runFinished}
              onClick={togglePause}
            >
              {runFinished ? 'Run ended' : isPaused ? 'Resume flight' : 'Pause flight'}
            </button>
            <button className="control-button" onClick={resetFlight}>
              {runFinished ? 'Fly again' : 'Reset position'}
            </button>
          </div>

          <div className="mission-grid">
            <MissionCard
              label="Score"
              title={telemetry.game.score.toLocaleString()}
              subtitle={getScoreSubtitle(telemetry.game, pilotMode)}
            />
            <MissionCard
              label="Medal"
              title={getMedalTitle(telemetry.game)}
              subtitle={formatMedalTargets()}
            />
            <MissionCard
              label="Course"
              title={getCourseTitle(telemetry.game, activeCheckpoint.label)}
              subtitle={getCourseSubtitle(telemetry.game, activeCheckpoint.label)}
            />
            <MissionCard
              label="Run Time"
              title={getRunTimeTitle(telemetry.game, telemetry.runElapsedMs)}
              subtitle={getRunTimeSubtitle(telemetry.game, pilotMode)}
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
                <li>`R`: reset position or restart a finished run</li>
                <li>`Space`: pause or resume an active run</li>
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
          <p className="detail-label">Arcade loop</p>
          <h2>Clear finish and fail states</h2>
          <p>
            Manual runs now resolve into medal-scored completions or terrain strikes,
            so every flight has a readable arcade outcome instead of an endless orbit.
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
  const runElapsedMs =
    game.runStartedAtMs === null
      ? null
      : game.finishTimeMs ?? now - game.runStartedAtMs

  return {
    clearanceFeet:
      terrainMeters === null ? null : (frame.altitudeMeters - terrainMeters) * 3.28084,
    frame,
    game,
    runElapsedMs,
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
    checkpointCaptures: 0,
    distanceToCheckpointMeters: nearest.distanceMeters,
    finishTimeMs: null,
    medalTier: null,
    runStartedAtMs: null,
    score: 0,
    status: 'preview',
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
    checkpointCaptures: 0,
    distanceToCheckpointMeters: distanceToCheckpoint(
      [frame.lng, frame.lat],
      activeCheckpointIndex,
    ),
    finishTimeMs: null,
    medalTier: null,
    runStartedAtMs: now,
    score: 0,
    status: 'running',
  }
}

function updateGameState(
  game: GameState,
  frame: SimFrame,
  terrainMeters: number | null,
  now: number,
): GameState {
  const distanceToTarget = distanceToCheckpoint(
    [frame.lng, frame.lat],
    game.activeCheckpointIndex,
  )

  if (game.status === 'finished' || game.status === 'crashed') {
    return game
  }

  if (isTerrainStrike(frame, terrainMeters)) {
    return {
      ...game,
      distanceToCheckpointMeters: distanceToTarget,
      finishTimeMs:
        game.runStartedAtMs === null ? null : now - game.runStartedAtMs,
      medalTier: null,
      status: 'crashed',
    }
  }

  if (game.runStartedAtMs === null || distanceToTarget > CHECKPOINT_CAPTURE_METERS) {
    return {
      ...game,
      distanceToCheckpointMeters: distanceToTarget,
    }
  }

  const checkpointCaptures = game.checkpointCaptures + 1
  const completedCourse = checkpointCaptures >= flightCheckpoints.length
  const nextCheckpointIndex =
    (game.activeCheckpointIndex + 1) % flightCheckpoints.length

  if (completedCourse) {
    const finishTimeMs = now - game.runStartedAtMs
    const medalTier = resolveMedalTier(finishTimeMs)

    return {
      ...game,
      checkpointCaptures,
      distanceToCheckpointMeters: 0,
      finishTimeMs,
      medalTier,
      score:
        game.score +
        CHECKPOINT_SCORE +
        FINISH_SCORE_BONUS +
        (medalTier === null ? 0 : MEDAL_SCORE_BONUS[medalTier]),
      status: 'finished',
    }
  }

  return {
    ...game,
    activeCheckpointIndex: nextCheckpointIndex,
    checkpointCaptures,
    distanceToCheckpointMeters: distanceToCheckpoint(
      [frame.lng, frame.lat],
      nextCheckpointIndex,
    ),
    score: game.score + CHECKPOINT_SCORE,
    status: 'running',
  }
}

function resolveMedalTier(durationMs: number): MedalTier | null {
  if (durationMs <= MEDAL_TARGETS_MS.gold) {
    return 'gold'
  }

  if (durationMs <= MEDAL_TARGETS_MS.silver) {
    return 'silver'
  }

  if (durationMs <= MEDAL_TARGETS_MS.bronze) {
    return 'bronze'
  }

  return null
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

function isTerminalGame(game: GameState): boolean {
  return game.status === 'finished' || game.status === 'crashed'
}

function formatRunStatusChip(status: RunStatus): string {
  switch (status) {
    case 'finished':
      return 'Course complete'
    case 'crashed':
      return 'Terrain strike'
    case 'running':
      return 'Manual run active'
    case 'preview':
      return 'Manual preview'
  }
}

function getScoreSubtitle(game: GameState, pilotMode: PilotMode): string {
  if (pilotMode === 'autopilot') {
    return 'Arm manual mode to start scoring'
  }

  if (game.status === 'finished') {
    return 'Finish and medal bonuses included'
  }

  if (game.status === 'crashed') {
    return 'Restart to improve the run'
  }

  return `${game.checkpointCaptures}/${flightCheckpoints.length} checkpoints captured`
}

function getMedalTitle(game: GameState): string {
  if (game.status === 'finished') {
    return game.medalTier === null
      ? 'Course clear'
      : `${capitalize(game.medalTier)} medal`
  }

  if (game.status === 'crashed') {
    return 'No award'
  }

  return 'Targets live'
}

function formatMedalTargets(): string {
  return [
    `Gold ${formatDuration(MEDAL_TARGETS_MS.gold)}`,
    `Silver ${formatDuration(MEDAL_TARGETS_MS.silver)}`,
    `Bronze ${formatDuration(MEDAL_TARGETS_MS.bronze)}`,
  ].join(' · ')
}

function getCourseTitle(game: GameState, activeCheckpointLabel: string): string {
  switch (game.status) {
    case 'finished':
      return 'Course complete'
    case 'crashed':
      return 'Terrain strike'
    case 'running':
    case 'preview':
      return activeCheckpointLabel
  }
}

function getCourseSubtitle(
  game: GameState,
  activeCheckpointLabel: string,
): string {
  switch (game.status) {
    case 'finished':
      return `${game.checkpointCaptures}/${flightCheckpoints.length} checkpoints cleared`
    case 'crashed':
      return `Missed ${activeCheckpointLabel}. Press R to restart`
    case 'running':
      return `${game.checkpointCaptures}/${flightCheckpoints.length} cleared · ${formatDistance(game.distanceToCheckpointMeters)}`
    case 'preview':
      return `${activeCheckpointLabel} · ${formatDistance(game.distanceToCheckpointMeters)}`
  }
}

function getRunTimeTitle(
  game: GameState,
  runElapsedMs: number | null,
): string {
  if (runElapsedMs === null) {
    return 'Standby'
  }

  return formatDuration(game.finishTimeMs ?? runElapsedMs)
}

function getRunTimeSubtitle(game: GameState, pilotMode: PilotMode): string {
  if (pilotMode === 'autopilot') {
    return 'Timer starts in manual mode'
  }

  if (game.status === 'finished') {
    return 'Completed one full checkpoint circuit'
  }

  if (game.status === 'crashed') {
    return 'Run ended on terrain impact'
  }

  return 'One lap decides the medal tier'
}

function getResultEyebrow(game: GameState): string {
  return game.status === 'finished' ? 'Run complete' : 'Run failed'
}

function getResultTitle(game: GameState): string {
  if (game.status === 'finished') {
    return game.medalTier === null
      ? 'Course clear'
      : `${capitalize(game.medalTier)} medal secured`
  }

  return 'Terrain strike'
}

function getResultBody(game: GameState): string {
  if (game.status === 'finished') {
    const finishTime = formatDuration(game.finishTimeMs ?? 0)
    if (game.medalTier === null) {
      return `You completed the route in ${finishTime}. Beat ${formatDuration(MEDAL_TARGETS_MS.bronze)} next run for bronze.`
    }

    return `Finished in ${finishTime} for ${game.score.toLocaleString()} points. Press R or tap Fly again to chase a faster medal.`
  }

  const finishTime =
    game.finishTimeMs === null ? 'the opening leg' : formatDuration(game.finishTimeMs)
  return `You clipped the terrain after ${finishTime}. Press R to restart the route or M to return to autopilot.`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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
