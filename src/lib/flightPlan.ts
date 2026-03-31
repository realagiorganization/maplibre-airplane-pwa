import type { Feature, LineString, Position } from 'geojson'

export interface RoutePoint {
  altitudeMeters: number
  bankRadians: number
  headingDegrees: number
  headingRadians: number
  lat: number
  lng: number
  pitchRadians: number
  progress: number
  speedKts: number
}

export interface FlightFrame extends RoutePoint {
  altitudeFeet: number
  loopPercent: number
  trailCoordinates: Position[]
}

export const LOOP_DURATION_MS = 92_000

const CENTER: Position = [11.3968, 47.2672]
const SAMPLE_COUNT = 360
const SEGMENT_DURATION_SECONDS = LOOP_DURATION_MS / SAMPLE_COUNT / 1_000
const FEET_PER_METER = 3.28084
const KNOTS_PER_METER_PER_SECOND = 1.94384

const routePoints = buildRoute()

export const flightRouteFeature: Feature<LineString> = {
  type: 'Feature',
  properties: {
    kind: 'planned-route',
  },
  geometry: {
    type: 'LineString',
    coordinates: routePoints.map((point) => [point.lng, point.lat]),
  },
}

export const flightCenter = CENTER

export function sampleFlight(elapsedMs: number): FlightFrame {
  const progress =
    ((elapsedMs % LOOP_DURATION_MS) + LOOP_DURATION_MS) % LOOP_DURATION_MS /
    LOOP_DURATION_MS
  const exactIndex = progress * routePoints.length
  const baseIndex = Math.floor(exactIndex) % routePoints.length
  const nextIndex = (baseIndex + 1) % routePoints.length
  const blend = exactIndex - Math.floor(exactIndex)

  const current = routePoints[baseIndex]
  const next = routePoints[nextIndex]

  const altitudeMeters = lerp(current.altitudeMeters, next.altitudeMeters, blend)
  const speedKts = lerp(current.speedKts, next.speedKts, blend)
  const headingRadians = interpolateAngle(
    current.headingRadians,
    next.headingRadians,
    blend,
  )
  const bankRadians = interpolateAngle(
    current.bankRadians,
    next.bankRadians,
    blend,
  )
  const pitchRadians = lerp(current.pitchRadians, next.pitchRadians, blend)
  const lng = lerp(current.lng, next.lng, blend)
  const lat = lerp(current.lat, next.lat, blend)

  return {
    altitudeFeet: altitudeMeters * FEET_PER_METER,
    altitudeMeters,
    bankRadians,
    headingDegrees: toDegrees(headingRadians),
    headingRadians,
    lat,
    lng,
    loopPercent: progress * 100,
    pitchRadians,
    progress,
    speedKts,
    trailCoordinates: buildTrailCoordinates(progress, baseIndex, blend, lng, lat),
  }
}

export function createTrailFeature(
  trailCoordinates: Position[],
): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {
      kind: 'progress-route',
    },
    geometry: {
      type: 'LineString',
      coordinates: trailCoordinates,
    },
  }
}

function buildRoute(): RoutePoint[] {
  const rawPoints = Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const progress = index / SAMPLE_COUNT
    const angle = progress * Math.PI * 2
    const lng =
      CENTER[0] +
      Math.cos(angle) * 0.09 +
      Math.sin(angle * 2.1 + 0.5) * 0.012 +
      Math.cos(angle * 4.4) * 0.0045
    const lat =
      CENTER[1] +
      Math.sin(angle) * 0.048 +
      Math.cos(angle * 1.7 - 0.2) * 0.01 +
      Math.sin(angle * 3.8) * 0.0032
    const altitudeMeters =
      2_180 +
      Math.sin(angle * 2 - 0.35) * 360 +
      Math.cos(angle * 5.1) * 120 +
      (Math.sin(angle * 0.5) + 1) * 70

    return {
      altitudeMeters,
      lat,
      lng,
      progress,
    }
  })

  return rawPoints.map((point, index) => {
    const next = rawPoints[(index + 1) % rawPoints.length]
    const previous = rawPoints[(index - 1 + rawPoints.length) % rawPoints.length]
    const groundDistance = distanceMeters(point.lng, point.lat, next.lng, next.lat)
    const headingRadians = Math.atan2(
      longitudeMeters(next.lng - point.lng, point.lat),
      latitudeMeters(next.lat - point.lat),
    )
    const nextHeading = Math.atan2(
      longitudeMeters(next.lng - point.lng, point.lat),
      latitudeMeters(next.lat - point.lat),
    )
    const previousHeading = Math.atan2(
      longitudeMeters(point.lng - previous.lng, previous.lat),
      latitudeMeters(point.lat - previous.lat),
    )
    const turnAmount = normalizeAngle(nextHeading - previousHeading)
    const climbGradient =
      (next.altitudeMeters - previous.altitudeMeters) /
      Math.max(
        distanceMeters(previous.lng, previous.lat, next.lng, next.lat),
        1,
      )

    return {
      altitudeMeters: point.altitudeMeters,
      bankRadians: clamp(-turnAmount * 2.25, -0.52, 0.52),
      headingDegrees: toDegrees(headingRadians),
      headingRadians,
      lat: point.lat,
      lng: point.lng,
      pitchRadians: clamp(climbGradient * 2.8, -0.2, 0.2),
      progress: point.progress,
      speedKts:
        (groundDistance / SEGMENT_DURATION_SECONDS) * KNOTS_PER_METER_PER_SECOND,
    }
  })
}

function buildTrailCoordinates(
  progress: number,
  baseIndex: number,
  blend: number,
  lng: number,
  lat: number,
): Position[] {
  const visiblePointCount = Math.max(12, Math.floor(progress * routePoints.length))
  const trail = routePoints
    .slice(0, visiblePointCount)
    .map((point) => [point.lng, point.lat] satisfies Position)

  if (progress > 0.998) {
    return flightRouteFeature.geometry.coordinates
  }

  if (baseIndex === 0 && blend === 0) {
    return [[routePoints[0].lng, routePoints[0].lat]]
  }

  return [...trail, [lng, lat]]
}

function distanceMeters(
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
): number {
  const deltaLongitude = longitudeMeters(endLng - startLng, (startLat + endLat) / 2)
  const deltaLatitude = latitudeMeters(endLat - startLat)

  return Math.hypot(deltaLongitude, deltaLatitude)
}

function longitudeMeters(deltaLongitude: number, latitude: number): number {
  return deltaLongitude * 111_320 * Math.cos((latitude * Math.PI) / 180)
}

function latitudeMeters(deltaLatitude: number): number {
  return deltaLatitude * 110_574
}

function lerp(start: number, end: number, blend: number): number {
  return start + (end - start) * blend
}

function interpolateAngle(start: number, end: number, blend: number): number {
  return start + normalizeAngle(end - start) * blend
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function toDegrees(radians: number): number {
  return ((radians * 180) / Math.PI + 360) % 360
}
