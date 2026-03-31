import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map,
} from 'maplibre-gl'
import * as THREE from 'three'
import type { FlightFrame } from './flightPlan'

export class AirplaneLayer implements CustomLayerInterface {
  id = 'airplane-layer'
  type = 'custom' as const
  renderingMode = '3d' as const

  private camera?: THREE.Camera
  private readonly getFrame: () => FlightFrame
  private headingGroup?: THREE.Group
  private map?: Map
  private pitchGroup?: THREE.Group
  private renderer?: THREE.WebGLRenderer
  private rollGroup?: THREE.Group
  private scene?: THREE.Scene

  constructor(getFrame: () => FlightFrame) {
    this.getFrame = getFrame
  }

  onAdd(map: Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.camera = new THREE.Camera()
    this.scene = new THREE.Scene()

    const ambientLight = new THREE.AmbientLight(0xdffaff, 2.1)
    const sunLight = new THREE.DirectionalLight(0xfff1d9, 1.9)
    sunLight.position.set(18, -26, 34)

    this.scene.add(ambientLight, sunLight)

    const { headingGroup, pitchGroup, rollGroup } = createAirframe()
    this.headingGroup = headingGroup
    this.pitchGroup = pitchGroup
    this.rollGroup = rollGroup

    this.scene.add(headingGroup)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      canvas: map.getCanvas(),
      context: gl,
    })
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    input: CustomRenderMethodInput,
  ) {
    if (
      !this.camera ||
      !this.headingGroup ||
      !this.pitchGroup ||
      !this.rollGroup ||
      !this.renderer ||
      !this.scene
    ) {
      return
    }

    const frame = this.getFrame()
    const coordinate = MercatorCoordinate.fromLngLat(
      [frame.lng, frame.lat],
      frame.altitudeMeters,
    )
    const meterScale = coordinate.meterInMercatorCoordinateUnits() * 1.2

    this.headingGroup.rotation.set(0, 0, -frame.headingRadians)
    this.pitchGroup.rotation.set(frame.pitchRadians, 0, 0)
    this.rollGroup.rotation.set(0, -frame.bankRadians, 0)

    const projection = new THREE.Matrix4().fromArray(
      input.defaultProjectionData.mainMatrix,
    )
    const model = new THREE.Matrix4()
      .makeTranslation(coordinate.x, coordinate.y, coordinate.z)
      .scale(new THREE.Vector3(meterScale, -meterScale, meterScale))

    this.camera.projectionMatrix = projection.multiply(model)
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
    this.map?.triggerRepaint()
  }
}

function createAirframe() {
  const headingGroup = new THREE.Group()
  const pitchGroup = new THREE.Group()
  const rollGroup = new THREE.Group()
  const plane = new THREE.Group()

  headingGroup.add(pitchGroup)
  pitchGroup.add(rollGroup)
  rollGroup.add(plane)

  const skin = new THREE.MeshStandardMaterial({
    color: '#f3efe3',
    metalness: 0.35,
    roughness: 0.45,
  })
  const accent = new THREE.MeshStandardMaterial({
    color: '#ef8d32',
    metalness: 0.25,
    roughness: 0.5,
  })
  const glass = new THREE.MeshStandardMaterial({
    color: '#79dbe6',
    emissive: '#133744',
    emissiveIntensity: 0.45,
    metalness: 0.2,
    roughness: 0.15,
  })
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: '#0c2633',
    metalness: 0.8,
    roughness: 0.3,
  })

  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.45, 14, 18),
    skin,
  )
  plane.add(fuselage)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.25, 3.2, 18), accent)
  nose.position.y = 8.55
  plane.add(nose)

  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.6, 18), skin)
  tailCone.position.y = -8.75
  tailCone.rotation.z = Math.PI
  plane.add(tailCone)

  const wing = new THREE.Mesh(new THREE.BoxGeometry(19, 0.8, 3.4), accent)
  plane.add(wing)

  const stabilizer = new THREE.Mesh(
    new THREE.BoxGeometry(7.6, 0.55, 1.55),
    accent,
  )
  stabilizer.position.set(0, -5.85, 1.25)
  plane.add(stabilizer)

  const verticalTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 2.2, 3.8),
    accent,
  )
  verticalTail.position.set(0, -6.2, 2.7)
  plane.add(verticalTail)

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.45, 16, 16), glass)
  cockpit.scale.set(1.1, 1.45, 0.75)
  cockpit.position.set(0, 2.1, 1.55)
  plane.add(cockpit)

  const leftEngine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 2.4, 16),
    engineMaterial,
  )
  leftEngine.rotation.z = Math.PI / 2
  leftEngine.position.set(-4.9, 0, -1.3)
  plane.add(leftEngine)

  const rightEngine = leftEngine.clone()
  rightEngine.position.x = 4.9
  plane.add(rightEngine)

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 12, 12),
    new THREE.MeshStandardMaterial({
      color: '#ffd073',
      emissive: '#ef8d32',
      emissiveIntensity: 0.85,
    }),
  )
  beacon.position.set(0, 6.3, 0)
  plane.add(beacon)

  plane.position.z = 0.8

  return {
    headingGroup,
    pitchGroup,
    rollGroup,
  }
}
