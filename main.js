import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'


// Scene
const scene = new THREE.Scene()

// Object Eye
const geometry = new THREE.SphereGeometry(3, 64, 64)
const material = new THREE.MeshStandardMaterial({
  color: "red",
  roughness: 0.4,
})
const sphere = new THREE.Mesh(geometry, material)



const geometryEye = new THREE.SphereGeometry(0.5, 64, 64)
const materialEye = new THREE.MeshStandardMaterial({
  color: "white",
  roughness: 0.4,
})
const sphereEye = new THREE.Mesh(geometryEye, materialEye)

//Irises
const geometryIris = new THREE.SphereGeometry(0.2, 64, 64)
const materialIris = new THREE.MeshStandardMaterial({
  color: "black",
  roughness: 0.2,
})
const sphereIris = new THREE.Mesh(geometryIris, materialIris)


scene.add(sphere)
sphere.add(sphereEye)
sphereEye.add(sphereIris)
sphereEye.position.set(2, 0, 2)
sphereIris.position.set(0.3, 0, 0.3)





//Sizes
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight
}


const ambientLight = new THREE.AmbientLight(0xffffff);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff);
directionalLight.position.set(10, 10, 20).normalize();
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0xffffff, 5, 1);
pointLight.position.set(10, 10, 20); // Set the position of the light
scene.add(pointLight);



const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 1000)
camera.position.set(0, 0, 9)
camera.lookAt(new THREE.Vector3(0, 0, 0))


// Axes helper
const axesHelper = new THREE.AxesHelper()
scene.add(axesHelper)


// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#bg'),
})
renderer.setSize(sizes.width, sizes.height)
renderer.render(scene, camera)
renderer.setPixelRatio(window.devicePixelRatio);

renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = Math.pow(0.94, 5.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;





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
  
  //Render
  renderer.render(scene, camera)

  //Call tick again on the next frame
  window.requestAnimationFrame(tick)
}

tick()


// Timeline
const tl = gsap.timeline({ defaults: { ease: 'power1.out', duration: 1 } })
// tl.fromTo(sphere.scale, {x: 0, y: 0, z: 0}, {x: 1, y: 1, z: 1})
tl.fromTo("nav", { y: "-100%" }, { y: "0%", duration: 0.5 })



window.addEventListener('mousemove', (event) => {
  // Calculate the rotation based on the mouse position
  const rotationX = (event.clientY / sizes.height) * Math.PI - Math.PI / 1.7    
  const rotationY = (event.clientX / sizes.width) * Math.PI - Math.PI / 1.3

  // Set the sphere's rotation
  sphere.rotation.set(rotationX, rotationY, 0);
})

document.addEventListener('touchmove', (event) => {
  // Prevent the default touch behavior
  event.preventDefault();

  // Get the first touch object
  const touch = event.touches[0];

  // Calculate the rotation based on the touch position
  const rotationX = (touch.clientY / sizes.height) * Math.PI - Math.PI / 1.7;
  const rotationY = (touch.clientX / sizes.width) * Math.PI - Math.PI / 1.3;

  // Set the sphere's rotation
  sphere.rotation.set(rotationX, rotationY, 0);

}, { passive: false });
