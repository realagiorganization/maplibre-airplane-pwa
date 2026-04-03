import { useState } from 'react'
import './App.css'
import { FlightExperience } from './components/FlightExperience'
import {
  flightMissions,
  getFlightMission,
  getMissionRouteSummary,
  type MedalTargets,
} from './lib/missions'
import { getFlightRoute } from './lib/routes'

function App() {
  const [selectedMissionId, setSelectedMissionId] = useState(flightMissions[0].id)
  const selectedMission = getFlightMission(selectedMissionId)
  const selectedRoute = getFlightRoute(selectedMission.routeId)

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Progressive Web App Flight Toy</p>
        <div className="hero-copy">
          <div>
            <h1>Fly a bright, blunt little airplane over an open 3D map stack.</h1>
            <p className="lede">
              MapLibre, OpenFreeMap, terrain tiles, and a small Three.js airframe
              packaged as an installable PWA and published with Fastlane through
              GitHub Actions.
            </p>
          </div>
          <article className="stack-card mission-spotlight">
            <p className="stack-label">Selected Mission</p>
            <h2>{selectedMission.title}</h2>
            <p className="mission-spotlight-meta">
              {selectedRoute.region} · {selectedMission.difficulty}
            </p>
            <p className="mission-spotlight-body">{selectedMission.summary}</p>
            <div className="mission-spotlight-stats">
              <span>{selectedRoute.name}</span>
              <span>{selectedRoute.checkpointCount} checkpoints</span>
              <span>Loop {formatDuration(selectedRoute.loopDurationMs)}</span>
            </div>
            <p className="mission-spotlight-medals">
              {formatMedalTargets(selectedMission.medalTargets)}
            </p>
          </article>
        </div>

        <div className="hero-support-grid">
          <section className="mission-selector-panel">
            <div className="mission-selector-header">
              <div>
                <p className="stack-label">Mission Selector</p>
                <h2>Pick the route pack seed you want to fly next.</h2>
              </div>
              <p className="mission-selector-caption">
                Switching missions rebuilds the map scene around a different cached
                route plan.
              </p>
            </div>

            <div className="mission-selector-grid">
              {flightMissions.map((mission) => {
                const route = getFlightRoute(mission.routeId)
                const selected = mission.id === selectedMissionId

                return (
                  <button
                    key={mission.id}
                    type="button"
                    className={`mission-option${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedMissionId(mission.id)}
                  >
                    <span className="mission-option-topline">
                      {mission.difficulty}
                    </span>
                    <strong>{mission.title}</strong>
                    <span className="mission-option-route">
                      {getMissionRouteSummary(mission)}
                    </span>
                    <span className="mission-option-summary">{mission.summary}</span>
                    <span className="mission-option-medals">
                      {formatMedalTargets(mission.medalTargets)}
                    </span>
                    <span className="mission-option-loop">
                      Loop {formatDuration(route.loopDurationMs)}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <div className="stack-card">
            <p className="stack-label">Published Stack</p>
            <ul className="stack-list">
              <li>MapLibre GL JS 3D map scene</li>
              <li>OpenFreeMap vector style + building extrusions</li>
              <li>Terrain DEM overlays for relief and pitch</li>
              <li>Three.js custom airplane layer</li>
              <li>Fastlane-driven GitHub Pages deployment</li>
            </ul>
          </div>
        </div>
      </section>

      <FlightExperience key={selectedMission.id} mission={selectedMission} />
    </main>
  )
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatMedalTargets(medalTargets: MedalTargets): string {
  return [
    `G ${formatDuration(medalTargets.gold)}`,
    `S ${formatDuration(medalTargets.silver)}`,
    `B ${formatDuration(medalTargets.bronze)}`,
  ].join(' · ')
}

export default App
