import './App.css'
import { FlightExperience } from './components/FlightExperience'

function App() {
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

      <FlightExperience />
    </main>
  )
}

export default App
