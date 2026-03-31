import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

import './FlightExperience.css'

type Waypoint = {
  label: string
  blurb: string
  coordinates: [number, number]
  zoom: number
  bearing: number
  altitudeFeet: number
  speedKnots: number
}

const waypoints: Waypoint[] = [
  {
    label: 'Bangkok River Run',
    blurb: 'Low-altitude cruise across the Chao Phraya skyline with a shallow left bank.',
    coordinates: [100.5018, 13.7563],
    zoom: 11.1,
    bearing: -18,
    altitudeFeet: 2400,
    speedKnots: 138,
  },
  {
    label: 'Don Mueang Climb',
    blurb: 'Pitch up and accelerate north to simulate a departure leg over the city edge.',
    coordinates: [100.607, 13.9125],
    zoom: 11.6,
    bearing: 22,
    altitudeFeet: 4100,
    speedKnots: 154,
  },
  {
    label: 'Gulf Turnback',
    blurb: 'Swing southeast, level out, and line up for a broad visual return leg.',
    coordinates: [100.6928, 13.5857],
    zoom: 10.7,
    bearing: 118,
    altitudeFeet: 3600,
    speedKnots: 146,
  },
]

function routeFeature() {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: waypoints.map((waypoint) => waypoint.coordinates),
        },
      },
      ...waypoints.map((waypoint) => ({
        type: 'Feature' as const,
        properties: { label: waypoint.label },
        geometry: {
          type: 'Point' as const,
          coordinates: waypoint.coordinates,
        },
      })),
    ],
  }
}

function formatCoordinates([lng, lat]: [number, number]) {
  return `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`
}

export function FlightExperience() {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) {
      return
    }

    const map = new maplibregl.Map({
      container: mapElementRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: waypoints[0].coordinates,
      zoom: waypoints[0].zoom,
      pitch: 58,
      bearing: waypoints[0].bearing,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    map.on('load', () => {
      map.addSource('route', {
        type: 'geojson',
        data: routeFeature(),
      })

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#79dbe6',
          'line-width': 4,
          'line-opacity': 0.72,
        },
      })

      map.addLayer({
        id: 'route-points',
        type: 'circle',
        source: 'route',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': '#ef8d32',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#07141c',
        },
      })

      const airplaneMarker = document.createElement('div')
      airplaneMarker.className = 'airplane-marker'
      airplaneMarker.textContent = '✈'

      markerRef.current = new maplibregl.Marker({
        element: airplaneMarker,
        rotationAlignment: 'map',
      })
        .setLngLat(waypoints[0].coordinates)
        .addTo(map)
    })

    mapRef.current = map

    return () => {
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % waypoints.length)
    }, 4200)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    const waypoint = waypoints[activeIndex]

    if (!map || !marker) {
      return
    }

    marker.setLngLat(waypoint.coordinates)
    map.flyTo({
      center: waypoint.coordinates,
      zoom: waypoint.zoom,
      pitch: 56 + activeIndex * 4,
      bearing: waypoint.bearing,
      duration: 3200,
      essential: true,
    })
  }, [activeIndex])

  const waypoint = waypoints[activeIndex]

  return (
    <section className="experience-grid">
      <article className="map-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Live Scene</p>
            <h2>{waypoint.label}</h2>
          </div>
          <p className="panel-copy">{waypoint.blurb}</p>
        </div>
        <div className="map-frame">
          <div ref={mapElementRef} className="map-canvas" />
          <div className="map-overlay">
            <span>Pitch-active map camera</span>
            <span>Installable PWA shell</span>
            <span>Animated route handoff</span>
          </div>
        </div>
      </article>

      <aside className="telemetry-column">
        <article className="telemetry-card telemetry-card-strong">
          <p className="panel-label">Current Leg</p>
          <h3>{waypoint.label}</h3>
          <dl className="telemetry-list">
            <div>
              <dt>Altitude</dt>
              <dd>{waypoint.altitudeFeet.toLocaleString()} ft</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{waypoint.speedKnots} kt</dd>
            </div>
            <div>
              <dt>Coords</dt>
              <dd>{formatCoordinates(waypoint.coordinates)}</dd>
            </div>
          </dl>
        </article>

        <article className="telemetry-card">
          <p className="panel-label">Flight Loop</p>
          <ol className="waypoint-list">
            {waypoints.map((entry, index) => (
              <li key={entry.label} className={index === activeIndex ? 'is-active' : undefined}>
                <span>{entry.label}</span>
                <small>{entry.altitudeFeet.toLocaleString()} ft</small>
              </li>
            ))}
          </ol>
        </article>

        <article className="telemetry-card">
          <p className="panel-label">Next Build Step</p>
          <p className="todo-copy">
            Replace the stylized flight loop with a proper aircraft state model,
            terrain-aware camera, and live control bindings.
          </p>
        </article>
      </aside>
    </section>
  )
}
