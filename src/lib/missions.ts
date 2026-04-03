import { getFlightRoute } from './routes'

export type MedalTier = 'bronze' | 'gold' | 'silver'

export type MedalTargets = Record<MedalTier, number>

export interface FlightMission {
  difficulty: string
  id: string
  medalTargets: MedalTargets
  routeId: string
  summary: string
  title: string
}

export const flightMissions: FlightMission[] = [
  {
    difficulty: 'Warmup',
    id: 'mission-alpine-sweep',
    medalTargets: {
      bronze: 132_000,
      gold: 102_000,
      silver: 116_000,
    },
    routeId: 'alpine-sweep',
    summary: 'Readable checkpoints and broad turns make this the cleanest first medal chase.',
    title: 'Alpine Sweep',
  },
  {
    difficulty: 'Athletic',
    id: 'mission-coastal-glide',
    medalTargets: {
      bronze: 128_000,
      gold: 98_000,
      silver: 112_000,
    },
    routeId: 'coastal-glide',
    summary: 'The coastline opens the camera up, but the faster medal windows punish sloppy banking.',
    title: 'Coastal Glide',
  },
  {
    difficulty: 'Demanding',
    id: 'mission-red-rock-run',
    medalTargets: {
      bronze: 138_000,
      gold: 108_000,
      silver: 122_000,
    },
    routeId: 'red-rock-run',
    summary: 'More checkpoints and tighter reversals turn this into the technical route pack seed.',
    title: 'Red Rock Run',
  },
]

export function getFlightMission(missionId: string): FlightMission {
  const mission = flightMissions.find((candidate) => candidate.id === missionId)

  if (!mission) {
    throw new Error(`Unknown mission: ${missionId}`)
  }

  return mission
}

export function getMissionRouteSummary(mission: FlightMission): string {
  const route = getFlightRoute(mission.routeId)

  return `${route.region} · ${route.checkpointCount} checkpoints`
}
