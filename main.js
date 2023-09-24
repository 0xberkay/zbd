import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Scene
const scene = new THREE.Scene()

// Object
const geometry = new THREE.SphereGeometry(3, 64, 64)
const material = new THREE.MeshStandardMaterial({
  color: "red",
  roughness: 0.4,
  })
const sphere = new THREE.Mesh(geometry, material)
scene.add(sphere)


//Sizes
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight
}


const light = new THREE.PointLight(0xffffff, 40, 100)
light.position.set(0,5,5)
light.castShadow = true

scene.add(light)




// Camera screen
const camera = new THREE.PerspectiveCamera( 45, sizes.width / sizes.height, 0.1, 100 );
camera.position.z = 20

// Axes helper
const axesHelper = new THREE.AxesHelper()
scene.add(axesHelper)


// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
})
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(sizes.width, sizes.height)
renderer.render(scene, camera)


// Controls
const controls = new OrbitControls(camera, document.querySelector('#bg'))
controls.enableDamping = true
controls.autoRotate = true
controls.autoRotateSpeed = 5
controls.enablePan = false
controls.enableZoom = false


//Window resize
window.addEventListener('resize', () => {
  //Update sizes
  sizes.width = window.innerWidth
  sizes.height = window.innerHeight

  //Update camera
  camera.aspect = sizes.width / sizes.height
  camera.updateProjectionMatrix()

  //Update renderer
  renderer.setSize(sizes.width, sizes.height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

//Loop
const tick = () => {
  //Update controls
  controls.update()

  //Render
  renderer.render(scene, camera)

  //Call tick again on the next frame
  window.requestAnimationFrame(tick)
}

tick()


// Timeline
const tl = gsap.timeline({defaults: {ease: 'power1.out', duration: 1}})
tl.fromTo(sphere.scale, {x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1})
tl.fromTo("nav", {y: "-100%"}, {y: "0%", duration: 0.5})

// Mouse animation color
let mouseDown = false

window.addEventListener('mousedown', () => {
  mouseDown = true
})

window.addEventListener('mouseup', () => {
  mouseDown = false
})

window.addEventListener('mousemove', (event) => {
  if(mouseDown) {
    const x = event.clientX
    const y = event.clientY

    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2

    const xAxis = (x - centerX) / 100
    const yAxis = (y - centerY) / 100

    gsap.to(sphere.material.color,{r: Math.abs(xAxis), g: Math.abs(yAxis), b: Math.abs(xAxis + yAxis)})
  }
})
