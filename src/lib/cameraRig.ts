import type { Map } from 'maplibre-gl'
import type { SimFrame } from './flightSimulation'

export type CameraMode = 'chase' | 'cinematic' | 'free'
export type FollowCameraMode = Exclude<CameraMode, 'free'>

interface CameraPadding {
  bottom: number
  left: number
  right: number
  top: number
}

export interface CameraRigState {
  bearing: number
  centerLat: number
  centerLng: number
  orbitPhase: number
  pitch: number
  zoom: number
}

interface CameraTarget {
  bearing: number
  centerLat: number
  centerLng: number
  padding: CameraPadding
  pitch: number
  zoom: number
}

const CHASE_PADDING: CameraPadding = {
  bottom: 240,
  left: 32,
  right: 32,
  top: 64,
}

const CINEMATIC_PADDING: CameraPadding = {
  bottom: 168,
  left: 72,
  right: 72,
  top: 120,
}

export function applyCameraRig(
  map: Map,
  rig: CameraRigState,
  mode: FollowCameraMode,
) {
  map.jumpTo({
    bearing: normalizeBearing(rig.bearing),
    center: [rig.centerLng, rig.centerLat],
    padding: getPaddingForMode(mode),
    pitch: rig.pitch,
    zoom: rig.zoom,
  })
}

export function captureCameraRig(map: Map, orbitPhase = 0): CameraRigState {
  const center = map.getCenter()

  return {
    bearing: normalizeBearing(map.getBearing()),
    centerLat: center.lat,
    centerLng: center.lng,
    orbitPhase,
    pitch: map.getPitch(),
    zoom: map.getZoom(),
  }
}

export function createCameraRig(
  frame: SimFrame,
  mode: FollowCameraMode,
  orbitPhase = 0,
): CameraRigState {
  const target = buildCameraTarget(frame, mode, orbitPhase)

  return {
    bearing: target.bearing,
    centerLat: target.centerLat,
    centerLng: target.centerLng,
    orbitPhase,
    pitch: target.pitch,
    zoom: target.zoom,
  }
}

export function getCameraActionLabel(mode: CameraMode): string {
  switch (mode) {
    case 'chase':
      return 'Switch to cinematic orbit'
    case 'cinematic':
      return 'Switch to free camera'
    case 'free':
      return 'Return to chase'
  }
}

export function getCameraModeLabel(mode: CameraMode): string {
  switch (mode) {
    case 'chase':
      return 'Chase camera'
    case 'cinematic':
      return 'Cinematic orbit'
    case 'free':
      return 'Free camera'
  }
}

export function isFollowCameraMode(
  mode: CameraMode,
): mode is FollowCameraMode {
  return mode !== 'free'
}

export function nextCameraMode(mode: CameraMode): CameraMode {
  switch (mode) {
    case 'chase':
      return 'cinematic'
    case 'cinematic':
      return 'free'
    case 'free':
      return 'chase'
  }
}

export function stepCameraRig(
  current: CameraRigState,
  frame: SimFrame,
  mode: FollowCameraMode,
  deltaSeconds: number,
): CameraRigState {
  const clampedDelta = clamp(deltaSeconds, 0.001, 0.05)
  const orbitPhase =
    mode === 'cinematic'
      ? current.orbitPhase + clampedDelta * 0.58
      : current.orbitPhase
  const target = buildCameraTarget(frame, mode, orbitPhase)
  const damping = mode === 'cinematic' ? 2.35 : 4.8

  return {
    bearing: dampAngle(current.bearing, target.bearing, damping, clampedDelta),
    centerLat: damp(current.centerLat, target.centerLat, damping, clampedDelta),
    centerLng: damp(current.centerLng, target.centerLng, damping, clampedDelta),
    orbitPhase,
    pitch: damp(current.pitch, target.pitch, damping, clampedDelta),
    zoom: damp(current.zoom, target.zoom, damping, clampedDelta),
  }
}

function buildCameraTarget(
  frame: Pick<SimFrame, 'headingDegrees' | 'lat' | 'lng' | 'mode'>,
  mode: FollowCameraMode,
  orbitPhase: number,
): CameraTarget {
  if (mode === 'cinematic') {
    const sweep = Math.sin(orbitPhase) * 34
    const manualBias = frame.mode === 'manual' ? 0.15 : 0

    return {
      bearing: frame.headingDegrees + 26 + sweep,
      centerLat: frame.lat,
      centerLng: frame.lng,
      padding: getPaddingForMode(mode),
      pitch: 64 + Math.cos(orbitPhase * 0.6 + manualBias) * 4,
      zoom: frame.mode === 'manual' ? 13.72 : 13.48,
    }
  }

  return {
    bearing: frame.headingDegrees,
    centerLat: frame.lat,
    centerLng: frame.lng,
    padding: getPaddingForMode(mode),
    pitch: 78,
    zoom: frame.mode === 'manual' ? 14.35 : 14.1,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function damp(
  current: number,
  target: number,
  smoothing: number,
  deltaSeconds: number,
): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds))
}

function dampAngle(
  current: number,
  target: number,
  smoothing: number,
  deltaSeconds: number,
): number {
  const factor = 1 - Math.exp(-smoothing * deltaSeconds)

  return normalizeBearing(
    current + shortestAngleDegrees(target - current) * factor,
  )
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360
}

function shortestAngleDegrees(value: number): number {
  return ((value + 540) % 360) - 180
}

function getPaddingForMode(mode: FollowCameraMode): CameraPadding {
  return mode === 'cinematic' ? CINEMATIC_PADDING : CHASE_PADDING
}
