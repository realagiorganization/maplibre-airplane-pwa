import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import maplibregl, { NavigationControl } from 'maplibre-gl'
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { HudPanel, type MissionCardData, type StatusChipData, type TelemetryCardData } from './HudPanel'
import { RunResultOverlay } from './RunResultOverlay'
import { TouchControls } from './TouchControls'
import { AirplaneLayer } from '../lib/airplaneLayer'
import {
  applyCameraRig,
  captureCameraRig,
  createCameraRig,
  getCameraActionLabel,
  getCameraModeLabel,
  isFollowCameraMode,
  nextCameraMode,
  stepCameraRig,
  type CameraMode,
  type CameraRigState,
} from '../lib/cameraRig'
import {
  createTrailFeature,
  getFlightPlan,
  type FlightCheckpoint,
} from '../lib/flightPlan'
import type { FlightMission, MedalTargets, MedalTier } from '../lib/missions'
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
const MEDAL_SCORE_BONUS: Record<MedalTier, number> = {
  bronze: 250,
  gold: 900,
  silver: 550,
}

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
  cameraMode: CameraMode
  cameraRig: CameraRigState
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

interface FlightExperienceProps {
  mission: FlightMission
}

export function FlightExperience({ mission }: FlightExperienceProps) {
  const flightPlan = getFlightPlan(mission.routeId)
  const flightCheckpoints = flightPlan.checkpoints
  const containerRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<Controller | null>(null)
  const activeInputsRef = useRef<Set<string>>(new Set())
  const [telemetry, setTelemetry] = useState<TelemetryState>(() => {
    const initialFrame = sampleAutopilotFrame(flightPlan, 0)
    const initialGame = createPreviewGameState(flightCheckpoints, initialFrame)

    return {
      clearanceFeet: null,
      frame: initialFrame,
      game: initialGame,
      runElapsedMs: null,
    }
  })
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase')
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

    const initialFrame = sampleAutopilotFrame(flightPlan, 0)
    const initialGame = createPreviewGameState(flightCheckpoints, initialFrame)
    const map = new maplibregl.Map({
      center: flightPlan.center as [number, number],
      container: containerRef.current,
      maxPitch: 85,
      pitch: 76,
      style: OPEN_MAP_STYLE,
      zoom: 13.7,
      canvasContextAttributes: { antialias: true },
    })

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')

    const controller: Controller = {
      cameraMode: 'chase',
      cameraRig: createCameraRig(initialFrame, 'chase'),
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
      configureMap(
        map,
        flightPlan.routeFeature,
        initialFrame.trailCoordinates,
        flightCheckpoints,
        initialGame.activeCheckpointIndex,
      )
      syncMapInteractions(map, controller.cameraMode)
      updateCheckpointSource(map, flightCheckpoints, controller.game)

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
            flightCheckpoints,
            mission.medalTargets,
            controller.game,
            nextFrame,
            nextTerrainMeters,
            timestamp,
          )
        } else {
          nextFrame = sampleAutopilotFrame(flightPlan, elapsedMs)
          nextGame = createPreviewGameState(flightCheckpoints, nextFrame)
        }

        controller.frame = nextFrame
        controller.game = nextGame
        updateTrail(map, nextFrame.trailCoordinates)
        updateCheckpointSource(map, flightCheckpoints, nextGame)
        if (isFollowCameraMode(controller.cameraMode)) {
          controller.cameraRig = stepCameraRig(
            controller.cameraRig,
            nextFrame,
            controller.cameraMode,
            deltaSeconds,
          )
          applyCameraRig(map, controller.cameraRig, controller.cameraMode)
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
      updateCheckpointSource(map, flightCheckpoints, controller.game)
      controller.cameraRig = createCameraRig(initialFrame, 'chase')
      applyCameraRig(map, controller.cameraRig, 'chase')
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
  }, [flightCheckpoints, flightPlan, mission.medalTargets])
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

    controller.cameraMode = nextCameraMode(controller.cameraMode)
    syncMapInteractions(controller.map, controller.cameraMode)
    setCameraMode(controller.cameraMode)

    if (isFollowCameraMode(controller.cameraMode)) {
      controller.cameraRig = captureCameraRig(
        controller.map,
        controller.cameraRig.orbitPhase,
      )
      controller.cameraRig = stepCameraRig(
        controller.cameraRig,
        controller.frame,
        controller.cameraMode,
        1 / 60,
      )
      applyCameraRig(controller.map, controller.cameraRig, controller.cameraMode)
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
    controller.game = createManualGameState(flightCheckpoints, controller.frame, now)
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, flightCheckpoints, controller.game)
    if (isFollowCameraMode(controller.cameraMode)) {
      controller.cameraRig = createCameraRig(
        controller.frame,
        controller.cameraMode,
        controller.cameraRig.orbitPhase,
      )
      applyCameraRig(controller.map, controller.cameraRig, controller.cameraMode)
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
        flightPlan,
        now - controller.simulationStartedAt - controller.timeOffsetMs,
      )
      controller.game = createPreviewGameState(flightCheckpoints, controller.frame)
      clearInputs()
      updateTrail(controller.map, controller.frame.trailCoordinates)
      updateCheckpointSource(controller.map, flightCheckpoints, controller.game)
      if (isFollowCameraMode(controller.cameraMode)) {
        controller.cameraRig = createCameraRig(
          controller.frame,
          controller.cameraMode,
          controller.cameraRig.orbitPhase,
        )
        applyCameraRig(controller.map, controller.cameraRig, controller.cameraMode)
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
    const resetFrame = sampleAutopilotFrame(flightPlan, 0)
    controller.frame =
      controller.mode === 'manual'
        ? createManualFlightFrame(resetFrame)
        : resetFrame
    controller.game =
      controller.mode === 'manual'
        ? createManualGameState(flightCheckpoints, controller.frame, now)
        : createPreviewGameState(flightCheckpoints, controller.frame)
    clearInputs()
    updateTrail(controller.map, controller.frame.trailCoordinates)
    updateCheckpointSource(controller.map, flightCheckpoints, controller.game)
    if (isFollowCameraMode(controller.cameraMode)) {
      controller.cameraRig = createCameraRig(
        controller.frame,
        controller.cameraMode,
        controller.cameraRig.orbitPhase,
      )
      applyCameraRig(controller.map, controller.cameraRig, controller.cameraMode)
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
  const showRunResult = pilotMode === 'manual' && runFinished
  const statusChips = [
    { label: 'MapLibre + OpenFreeMap', variant: 'accent' },
    {
      label:
        pilotMode === 'manual'
          ? formatRunStatusChip(telemetry.game.status)
          : 'Autopilot orbit',
      variant:
        telemetry.game.status === 'finished'
          ? 'success'
          : telemetry.game.status === 'crashed'
            ? 'danger'
            : undefined,
    },
    {
      label: getCameraModeLabel(cameraMode),
    },
    {
      label: runFinished
        ? 'Press R to restart'
        : isPaused
          ? 'Simulation paused'
          : 'Simulation live',
      variant: isPaused && !runFinished ? 'warning' : undefined,
    },
  ] satisfies StatusChipData[]
  const telemetryCards = [
    {
      label: 'Speed',
      value: `${Math.round(telemetry.frame.speedKts)} kt`,
    },
    {
      label: 'Altitude',
      value: `${Math.round(telemetry.frame.altitudeFeet).toLocaleString()} ft`,
    },
    {
      label: 'Heading',
      value: `${Math.round(telemetry.frame.headingDegrees)
        .toString()
        .padStart(3, '0')}°`,
    },
    {
      label: pilotMode === 'manual' ? 'Throttle' : 'Loop',
      value:
        pilotMode === 'manual'
          ? `${Math.round(telemetry.frame.throttlePercent)}%`
          : `${Math.round(telemetry.frame.loopPercent)}%`,
    },
    {
      label: 'Bank',
      value: `${Math.round((telemetry.frame.bankRadians * 180) / Math.PI)}°`,
    },
    {
      label: 'Clearance',
      value:
        telemetry.clearanceFeet === null
          ? 'Terrain n/a'
          : `${Math.round(telemetry.clearanceFeet).toLocaleString()} ft`,
    },
  ] satisfies TelemetryCardData[]
  const missionCards = [
    {
      label: 'Score',
      title: telemetry.game.score.toLocaleString(),
      subtitle: getScoreSubtitle(telemetry.game, pilotMode, flightCheckpoints.length),
    },
    {
      label: 'Medal',
      title: getMedalTitle(telemetry.game),
      subtitle: formatMedalTargets(mission.medalTargets),
    },
    {
      label: 'Course',
      title: getCourseTitle(telemetry.game, activeCheckpoint.label),
      subtitle: getCourseSubtitle(
        telemetry.game,
        activeCheckpoint.label,
        flightCheckpoints.length,
      ),
    },
    {
      label: 'Run Time',
      title: getRunTimeTitle(telemetry.game, telemetry.runElapsedMs),
      subtitle: getRunTimeSubtitle(telemetry.game, pilotMode),
    },
  ] satisfies MissionCardData[]

  return (
    <section className="experience-shell">
      <div className="map-stage">
        <div ref={containerRef} className="map-canvas" />

        {showRunResult ? (
          <RunResultOverlay
            body={getResultBody(telemetry.game, mission.medalTargets)}
            eyebrow={getResultEyebrow(telemetry.game)}
            isFinished={telemetry.game.status === 'finished'}
            onFlyAgain={resetFlight}
            onReturnToAutopilot={togglePilotMode}
            title={getResultTitle(telemetry.game)}
          />
        ) : null}

        <TouchControls
          activeInputs={activeTouchInputs}
          onActiveChange={setTouchControl}
        />

        <HudPanel
          cameraActionLabel={getCameraActionLabel(cameraMode)}
          missionCards={missionCards}
          onCameraAction={toggleCameraMode}
          onPauseAction={togglePause}
          onPrimaryAction={togglePilotMode}
          onResetAction={resetFlight}
          pauseActionLabel={
            runFinished ? 'Run ended' : isPaused ? 'Resume flight' : 'Pause flight'
          }
          pauseDisabled={runFinished}
          primaryActionLabel={
            pilotMode === 'manual' ? 'Return to autopilot' : 'Take manual control'
          }
          resetActionLabel={runFinished ? 'Fly again' : 'Reset position'}
          statusChips={statusChips}
          telemetryCards={telemetryCards}
        />
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

function configureMap(
  map: Map,
  routeFeature: Feature<LineString>,
  initialTrailCoordinates: Position[],
  checkpoints: FlightCheckpoint[],
  activeCheckpointIndex: number,
) {
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
      data: routeFeature,
    })
  }

  if (!map.getSource(TRAIL_SOURCE_ID)) {
    map.addSource(TRAIL_SOURCE_ID, {
      type: 'geojson',
      data: createTrailFeature(initialTrailCoordinates),
    })
  }

  if (!map.getSource(CHECKPOINT_SOURCE_ID)) {
    map.addSource(CHECKPOINT_SOURCE_ID, {
      type: 'geojson',
      data: buildCheckpointFeatureCollection(checkpoints, activeCheckpointIndex),
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

function updateCheckpointSource(
  map: Map,
  checkpoints: FlightCheckpoint[],
  game: GameState,
) {
  const checkpointSource = map.getSource(CHECKPOINT_SOURCE_ID) as
    | GeoJSONSource
    | undefined
  if (!checkpointSource) {
    return
  }

  checkpointSource.setData(
    buildCheckpointFeatureCollection(checkpoints, game.activeCheckpointIndex),
  )
}

function syncMapInteractions(map: Map, cameraMode: CameraMode) {
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
    if (cameraMode === 'free') {
      method.enable()
    } else {
      method.disable()
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

function createPreviewGameState(
  checkpoints: FlightCheckpoint[],
  frame: SimFrame,
): GameState {
  const nearest = findNearestCheckpoint(checkpoints, [frame.lng, frame.lat])

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

function createManualGameState(
  checkpoints: FlightCheckpoint[],
  frame: SimFrame,
  now: number,
): GameState {
  const nearest = findNearestCheckpoint(checkpoints, [frame.lng, frame.lat])
  const activeCheckpointIndex =
    nearest.distanceMeters < CHECKPOINT_CAPTURE_METERS
      ? (nearest.index + 1) % checkpoints.length
      : nearest.index

  return {
    activeCheckpointIndex,
    checkpointCaptures: 0,
    distanceToCheckpointMeters: distanceToCheckpoint(
      checkpoints,
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
  checkpoints: FlightCheckpoint[],
  medalTargets: MedalTargets,
  game: GameState,
  frame: SimFrame,
  terrainMeters: number | null,
  now: number,
): GameState {
  const distanceToTarget = distanceToCheckpoint(
    checkpoints,
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
  const completedCourse = checkpointCaptures >= checkpoints.length
  const nextCheckpointIndex = (game.activeCheckpointIndex + 1) % checkpoints.length

  if (completedCourse) {
    const finishTimeMs = now - game.runStartedAtMs
    const medalTier = resolveMedalTier(finishTimeMs, medalTargets)

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
      checkpoints,
      [frame.lng, frame.lat],
      nextCheckpointIndex,
    ),
    score: game.score + CHECKPOINT_SCORE,
    status: 'running',
  }
}

function resolveMedalTier(
  durationMs: number,
  medalTargets: MedalTargets,
): MedalTier | null {
  if (durationMs <= medalTargets.gold) {
    return 'gold'
  }

  if (durationMs <= medalTargets.silver) {
    return 'silver'
  }

  if (durationMs <= medalTargets.bronze) {
    return 'bronze'
  }

  return null
}

function buildCheckpointFeatureCollection(
  checkpoints: FlightCheckpoint[],
  activeCheckpointIndex: number,
): FeatureCollection<Point, { active: number; label: string }> {
  return {
    type: 'FeatureCollection',
    features: checkpoints.map((checkpoint, index) => ({
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

function findNearestCheckpoint(
  checkpoints: FlightCheckpoint[],
  point: [number, number],
) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < checkpoints.length; index += 1) {
    const distance = distanceToCheckpoint(checkpoints, point, index)
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

function distanceToCheckpoint(
  checkpoints: FlightCheckpoint[],
  point: [number, number],
  checkpointIndex: number,
) {
  const checkpoint = checkpoints[checkpointIndex]
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

function getScoreSubtitle(
  game: GameState,
  pilotMode: PilotMode,
  checkpointCount: number,
): string {
  if (pilotMode === 'autopilot') {
    return 'Arm manual mode to start scoring'
  }

  if (game.status === 'finished') {
    return 'Finish and medal bonuses included'
  }

  if (game.status === 'crashed') {
    return 'Restart to improve the run'
  }

  return `${game.checkpointCaptures}/${checkpointCount} checkpoints captured`
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

function formatMedalTargets(medalTargets: MedalTargets): string {
  return [
    `Gold ${formatDuration(medalTargets.gold)}`,
    `Silver ${formatDuration(medalTargets.silver)}`,
    `Bronze ${formatDuration(medalTargets.bronze)}`,
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
  checkpointCount: number,
): string {
  switch (game.status) {
    case 'finished':
      return `${game.checkpointCaptures}/${checkpointCount} checkpoints cleared`
    case 'crashed':
      return `Missed ${activeCheckpointLabel}. Press R to restart`
    case 'running':
      return `${game.checkpointCaptures}/${checkpointCount} cleared · ${formatDistance(game.distanceToCheckpointMeters)}`
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

function getResultBody(game: GameState, medalTargets: MedalTargets): string {
  if (game.status === 'finished') {
    const finishTime = formatDuration(game.finishTimeMs ?? 0)
    if (game.medalTier === null) {
      return `You completed the route in ${finishTime}. Beat ${formatDuration(medalTargets.bronze)} next run for bronze.`
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
