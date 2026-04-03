import type { Position } from 'geojson'

export interface RouteSamplePoint {
  altitudeMeters: number
  lat: number
  lng: number
}

export interface FlightRouteDefinition {
  blurb: string
  center: Position
  checkpointCount: number
  id: string
  loopDurationMs: number
  name: string
  region: string
  sampleCount: number
  samplePoint: (progress: number, center: Position) => RouteSamplePoint
}

export const flightRoutes: FlightRouteDefinition[] = [
  {
    blurb: 'A broad alpine orbit that keeps terrain close and checkpoint spacing forgiving.',
    center: [11.3968, 47.2672],
    checkpointCount: 6,
    id: 'alpine-sweep',
    loopDurationMs: 92_000,
    name: 'Alpine Sweep',
    region: 'Innsbruck, Austria',
    sampleCount: 360,
    samplePoint(progress, center) {
      const angle = progress * Math.PI * 2

      return {
        altitudeMeters:
          2_180 +
          Math.sin(angle * 2 - 0.35) * 360 +
          Math.cos(angle * 5.1) * 120 +
          (Math.sin(angle * 0.5) + 1) * 70,
        lat:
          center[1] +
          Math.sin(angle) * 0.048 +
          Math.cos(angle * 1.7 - 0.2) * 0.01 +
          Math.sin(angle * 3.8) * 0.0032,
        lng:
          center[0] +
          Math.cos(angle) * 0.09 +
          Math.sin(angle * 2.1 + 0.5) * 0.012 +
          Math.cos(angle * 4.4) * 0.0045,
      }
    },
  },
  {
    blurb: 'An east-west coastal run with wider banking and a flatter sea-level chase line.',
    center: [18.0944, 42.6507],
    checkpointCount: 7,
    id: 'coastal-glide',
    loopDurationMs: 88_000,
    name: 'Coastal Glide',
    region: 'Dubrovnik, Croatia',
    sampleCount: 340,
    samplePoint(progress, center) {
      const angle = progress * Math.PI * 2

      return {
        altitudeMeters:
          1_020 +
          Math.sin(angle * 2.6 + 0.25) * 180 +
          Math.cos(angle * 4.8 - 0.4) * 82 +
          (Math.cos(angle * 0.8) + 1) * 55,
        lat:
          center[1] +
          Math.sin(angle * 0.96) * 0.034 +
          Math.cos(angle * 2.4 - 0.55) * 0.016 +
          Math.sin(angle * 6.2) * 0.0026,
        lng:
          center[0] +
          Math.cos(angle * 1.08 + 0.2) * 0.118 +
          Math.sin(angle * 3.5 - 0.1) * 0.0105 +
          Math.cos(angle * 5.7) * 0.0038,
      }
    },
  },
  {
    blurb: 'A tighter red-rock figure with quicker reversals, steeper climbs, and denser checkpoints.',
    center: [-109.5498, 38.5733],
    checkpointCount: 8,
    id: 'red-rock-run',
    loopDurationMs: 96_000,
    name: 'Red Rock Run',
    region: 'Moab, Utah',
    sampleCount: 380,
    samplePoint(progress, center) {
      const angle = progress * Math.PI * 2

      return {
        altitudeMeters:
          1_760 +
          Math.sin(angle * 3.1 + 0.4) * 230 +
          Math.cos(angle * 1.4 - 0.3) * 110 +
          (Math.cos(angle * 5.4) + 1) * 44,
        lat:
          center[1] +
          Math.sin(angle * 2.02) * 0.029 +
          Math.cos(angle - 0.35) * 0.019 +
          Math.cos(angle * 4.1 + 0.5) * 0.0031,
        lng:
          center[0] +
          Math.sin(angle) * 0.082 +
          Math.sin(angle * 3.2 - 0.45) * 0.0115 +
          Math.cos(angle * 0.55 + 0.25) * 0.0064,
      }
    },
  },
]

export function getFlightRoute(routeId: string): FlightRouteDefinition {
  const route = flightRoutes.find((candidate) => candidate.id === routeId)

  if (!route) {
    throw new Error(`Unknown flight route: ${routeId}`)
  }

  return route
}
