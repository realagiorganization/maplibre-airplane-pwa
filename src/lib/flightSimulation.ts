import type { Position } from 'geojson'
import type { FlightFrame, FlightPlan } from './flightPlan'

export type PilotMode = 'autopilot' | 'manual'

export interface SimFrame extends FlightFrame {
  mode: PilotMode
  throttlePercent: number
}

export interface FlightInputs {
  pitch: number
  roll: number
  throttle: number
}

const FEET_PER_METER = 3.28084
const KNOTS_PER_METER_PER_SECOND = 1.94384
const LATITUDE_METERS_PER_DEGREE = 110_574
const TERRAIN_STRIKE_CLEARANCE_METERS = 24
const MIN_THROTTLE_PERCENT = 38
const MAX_THROTTLE_PERCENT = 100
const MAX_BANK_RADIANS = 0.72
const MAX_PITCH_RADIANS = 0.22
const TARGET_TRAIL_SPACING_METERS = 110
const MAX_TRAIL_POINTS = 420

export function sampleAutopilotFrame(
  flightPlan: FlightPlan,
  elapsedMs: number,
): SimFrame {
  const frame = flightPlan.sampleFlight(elapsedMs)

  return {
    ...frame,
    mode: 'autopilot',
    throttlePercent: clamp((frame.speedKts - 100) * 0.82, 48, 74),
  }
}

export function createManualFlightFrame(seed: FlightFrame): SimFrame {
  return {
    ...seed,
    loopPercent: 0,
    mode: 'manual',
    throttlePercent: 66,
    trailCoordinates:
      seed.trailCoordinates.length > 2
        ? seed.trailCoordinates.slice(-140)
        : [[seed.lng, seed.lat]],
  }
}

export function stepManualFlight(
  current: SimFrame,
  inputs: FlightInputs,
  deltaSeconds: number,
  terrainElevationMeters: number | null,
): SimFrame {
  const clampedDelta = clamp(deltaSeconds, 0.001, 0.05)
  const throttlePercent = clamp(
    current.throttlePercent + inputs.throttle * 34 * clampedDelta,
    MIN_THROTTLE_PERCENT,
    MAX_THROTTLE_PERCENT,
  )

  const bankRadians = damp(
    current.bankRadians,
    inputs.roll * MAX_BANK_RADIANS,
    3.3,
    clampedDelta,
  )
  const pitchRadians = damp(
    current.pitchRadians,
    inputs.pitch * MAX_PITCH_RADIANS,
    2.7,
    clampedDelta,
  )

  const targetSpeedKts = 84 + throttlePercent * 1.28
  const dragPenalty = Math.abs(bankRadians) * 11 + Math.abs(pitchRadians) * 19
  const speedKts = Math.max(
    88,
    damp(current.speedKts, targetSpeedKts - dragPenalty, 1.2, clampedDelta),
  )
  const speedMetersPerSecond = speedKts / KNOTS_PER_METER_PER_SECOND

  const headingRadians = normalizeAngle(
    current.headingRadians +
      (Math.tan(bankRadians) * speedMetersPerSecond * clampedDelta) / 245,
  )

  const horizontalMeters =
    Math.cos(pitchRadians) * speedMetersPerSecond * clampedDelta
  const northMeters = Math.cos(headingRadians) * horizontalMeters
  const eastMeters = Math.sin(headingRadians) * horizontalMeters
  const lat = current.lat + northMeters / LATITUDE_METERS_PER_DEGREE
  const longitudeMetersPerDegree =
    111_320 * Math.cos((current.lat * Math.PI) / 180)
  const lng = current.lng + eastMeters / Math.max(longitudeMetersPerDegree, 1)

  let altitudeMeters =
    current.altitudeMeters +
    Math.sin(pitchRadians) * speedMetersPerSecond * clampedDelta

  if (
    terrainElevationMeters !== null &&
    altitudeMeters < terrainElevationMeters + TERRAIN_STRIKE_CLEARANCE_METERS / 2
  ) {
    altitudeMeters = terrainElevationMeters + TERRAIN_STRIKE_CLEARANCE_METERS / 2
  }

  const trailCoordinates = updateTrail(current.trailCoordinates, [lng, lat])

  return {
    altitudeFeet: altitudeMeters * FEET_PER_METER,
    altitudeMeters,
    bankRadians,
    headingDegrees: toDegrees(headingRadians),
    headingRadians,
    lat,
    lng,
    loopPercent: 0,
    mode: 'manual',
    pitchRadians,
    progress: current.progress,
    speedKts,
    throttlePercent,
    trailCoordinates,
  }
}

export function getTerrainClearanceMeters(
  frame: Pick<SimFrame, 'altitudeMeters'>,
  terrainElevationMeters: number | null,
): number | null {
  return terrainElevationMeters === null
    ? null
    : frame.altitudeMeters - terrainElevationMeters
}

export function isTerrainStrike(
  frame: Pick<SimFrame, 'altitudeMeters'>,
  terrainElevationMeters: number | null,
): boolean {
  const clearanceMeters = getTerrainClearanceMeters(frame, terrainElevationMeters)

  return (
    clearanceMeters !== null &&
    clearanceMeters <= TERRAIN_STRIKE_CLEARANCE_METERS
  )
}

function updateTrail(trail: Position[], point: Position): Position[] {
  if (trail.length === 0) {
    return [point]
  }

  const last = trail[trail.length - 1]
  const gapMeters = distanceMeters(last[0], last[1], point[0], point[1])
  if (gapMeters < TARGET_TRAIL_SPACING_METERS) {
    return [...trail.slice(0, -1), point]
  }

  return [...trail, point].slice(-MAX_TRAIL_POINTS)
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
  const deltaLatitudeMeters = (endLat - startLat) * LATITUDE_METERS_PER_DEGREE

  return Math.hypot(deltaLongitudeMeters, deltaLatitudeMeters)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function damp(
  current: number,
  target: number,
  smoothing: number,
  delta: number,
): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * delta))
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function toDegrees(radians: number): number {
  return ((radians * 180) / Math.PI + 360) % 360
}
