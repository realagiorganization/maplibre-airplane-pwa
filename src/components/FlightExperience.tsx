import type { Position } from 'geojson'
import type { GeoJSONSource, Map } from 'maplibre-gl'
import maplibregl, { NavigationControl } from 'maplibre-gl'
import { startTransition, useEffect, useRef, useState } from 'react'
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

interface TelemetryState {
  clearanceFeet: number | null
  frame: SimFrame
}

type Controller = {
  followCamera: boolean
  frame: SimFrame
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

const initialFrame = sampleAutopilotFrame(0)

export function FlightExperience() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<Controller | null>(null)
  const activeKeysRef = useRef<Set<string>>(new Set())
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    clearanceFeet: null,
    frame: initialFrame,
  })
  const [cameraMode, setCameraMode] = useState<'chase' | 'free'>('chase')
  const [isPaused, setIsPaused] = useState(false)
  const [pilotMode, setPilotMode] = useState<PilotMode>('autopilot')

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

      controller.tick = (timestamp: number) => {
        if (controller.paused) {
          controller.rafId = null
          return
        }

        const elapsedMs =
          timestamp - controller.simulationStartedAt - controller.timeOffsetMs
        const deltaSeconds = (timestamp - controller.lastTickMs) / 1000
        controller.lastTickMs = timestamp

        const inputs = readInputs(activeKeysRef.current)
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
        } else {
          nextFrame = sampleAutopilotFrame(elapsedMs)
        }

        controller.frame = nextFrame
        updateTrail(map, nextFrame.trailCoordinates)
        if (controller.followCamera) {
          updateChaseCamera(map, nextFrame)
        }

        startTransition(() => {
          setTelemetry(buildTelemetryState(map, nextFrame))
        })

        controller.rafId = requestAnimationFrame(controller.tick)
      }

      map.addLayer(new AirplaneLayer(() => controller.frame))
      updateTrail(map, initialFrame.trailCoordinates)
      updateChaseCamera(map, initialFrame)
      setTelemetry(buildTelemetryState(map, initialFrame))
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

    controller.mode = 'manual'
    controller.frame = createManualFlightFrame(controller.frame)
    controller.lastTickMs = performance.now()
    updateTrail(controller.map, controller.frame.trailCoordinates)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame))
    setPilotMode('manual')
  }

  function togglePilotMode() {
    const controller = controllerRef.current
    if (!controller) {
      return
    }

    if (controller.mode === 'manual') {
      controller.mode = 'autopilot'
      controller.frame = sampleAutopilotFrame(
        performance.now() - controller.simulationStartedAt - controller.timeOffsetMs,
      )
      activeKeysRef.current.clear()
      updateTrail(controller.map, controller.frame.trailCoordinates)
      if (controller.followCamera) {
        updateChaseCamera(controller.map, controller.frame)
      }
      setTelemetry(buildTelemetryState(controller.map, controller.frame))
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

    const resetFrame = sampleAutopilotFrame(0)
    controller.frame =
      controller.mode === 'manual'
        ? createManualFlightFrame(resetFrame)
        : resetFrame
    controller.lastTickMs = performance.now()
    updateTrail(controller.map, controller.frame.trailCoordinates)
    if (controller.followCamera) {
      updateChaseCamera(controller.map, controller.frame)
    }
    setTelemetry(buildTelemetryState(controller.map, controller.frame))
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = normalizeKey(event.key)
      if (!CONTROL_KEYS.has(key)) {
        return
      }

      event.preventDefault()
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

      activeKeysRef.current.add(key)
      if (controllerRef.current?.mode === 'autopilot') {
        armManualMode()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      activeKeysRef.current.delete(normalizeKey(event.key))
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  })

  return (
    <section className="experience-shell">
      <div className="map-stage">
        <div ref={containerRef} className="map-canvas" />

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
              <p className="controls-label">Mode keys</p>
              <ul>
                <li>`M`: toggle autopilot/manual</li>
                <li>`C`: toggle chase camera</li>
                <li>`R`: reset position</li>
                <li>`Space`: pause or resume</li>
                <li>Drag map only in free camera</li>
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
          <p className="detail-label">Flight modes</p>
          <h2>Autopilot plus manual override</h2>
          <p>
            The scenic orbit keeps the scene alive by default, and any flight input
            can hand control to a small local dynamics model.
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

function buildTelemetryState(map: Map, frame: SimFrame): TelemetryState {
  const terrainMeters = map.queryTerrainElevation([frame.lng, frame.lat]) ?? null

  return {
    clearanceFeet:
      terrainMeters === null ? null : (frame.altitudeMeters - terrainMeters) * 3.28084,
    frame,
  }
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
}

function updateTrail(map: Map, trailCoordinates: Position[]) {
  const trailSource = map.getSource(TRAIL_SOURCE_ID) as GeoJSONSource | undefined
  if (!trailSource) {
    return
  }

  trailSource.setData(createTrailFeature(trailCoordinates))
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
