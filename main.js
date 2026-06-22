import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canvas = document.querySelector('#scene')

/* -------------------------------------------------------------- renderer */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
camera.position.set(0, 0, 10)

let vW = 0, vH = 0          // visible world size at z=0
function visibleSize() {
  const h = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z
  vH = h
  vW = h * camera.aspect
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  visibleSize()
  layout()
}

/* ------------------------------------------------------ image -> layers */
// IMAGE REGIONS (uv, origin top-left): tuned to knight.webp composition.
const KNIGHT = { cx: 0.34, cy: 0.62, rx: 0.30, ry: 0.42 }  // kneeling knight, left-centre
const TREE = { u: 0.86, v: 0.30 }                          // lone tree, right
const TREECUT = { cx: 0.86, cy: 0.34, rx: 0.13, ry: 0.24 } // tree cutout region

const loader = new THREE.TextureLoader()
let bgMesh, knightMesh, treeMesh, coverScaleW = 1, coverScaleH = 1, imgAspect = 1.45

// brighten + warm the (too-dark) photo once, reuse for bg and all cutouts
function gradeImage(img) {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const g = c.getContext('2d')
  g.filter = 'brightness(1.95) contrast(1.02) saturate(1.2)'
  g.drawImage(img, 0, 0)
  return c
}

// cover-fit: scale a 1x1 plane to fill viewport (like object-fit: cover)
function coverScale() {
  let sw = vH * imgAspect, sh = vH
  if (sw < vW) { sw = vW; sh = vW / imgAspect }
  coverScaleW = sw; coverScaleH = sh
}
// uv (top-left origin) -> world position on the cover plane
function uvToWorld(u, v) {
  return { x: (u - 0.5) * coverScaleW, y: (0.5 - v) * coverScaleH }
}

// cut a feathered elliptical region out of the graded photo -> own texture
function buildCutout(graded, r) {
  const c = document.createElement('canvas')
  c.width = graded.width; c.height = graded.height
  const g = c.getContext('2d')
  g.drawImage(graded, 0, 0)
  g.globalCompositeOperation = 'destination-in'
  const cx = r.cx * c.width, cy = r.cy * c.height
  const rx = r.rx * c.width, ry = r.ry * c.height
  const grad = g.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry))
  grad.addColorStop(0, 'rgba(0,0,0,1)')
  grad.addColorStop(0.7, 'rgba(0,0,0,1)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.save()
  g.translate(cx, cy); g.scale(rx, ry); g.translate(-cx, -cy)
  g.fillStyle = grad
  g.beginPath(); g.arc(cx, cy, 1, 0, Math.PI * 2); g.fill()
  g.restore()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function buildScene(tex, img) {
  imgAspect = img.naturalWidth / img.naturalHeight
  const graded = gradeImage(img)

  const geo = new THREE.PlaneGeometry(1, 1, 1, 1)

  // background = brightened full image
  const bgTex = new THREE.CanvasTexture(graded)
  bgTex.colorSpace = THREE.SRGBColorSpace
  const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, transparent: true, opacity: 0 })
  bgMesh = new THREE.Mesh(geo, bgMat)
  bgMesh.position.z = -1.4
  scene.add(bgMesh)

  // tree cutout, mid layer
  const tMat = new THREE.MeshBasicMaterial({ map: buildCutout(graded, TREECUT), transparent: true, opacity: 0 })
  treeMesh = new THREE.Mesh(geo, tMat)
  treeMesh.position.z = 0.7
  scene.add(treeMesh)

  // knight cutout, pulled toward the camera for strongest 3D separation
  const kMat = new THREE.MeshBasicMaterial({ map: buildCutout(graded, KNIGHT), transparent: true, opacity: 0 })
  knightMesh = new THREE.Mesh(geo, kMat)
  knightMesh.position.z = 2.1
  scene.add(knightMesh)

  layout()
  emitterReady = true
  intro()
}

// scale a plane so it overlaps the same screen footprint as the background
function fitFactor(mesh) {
  return (camera.position.z - mesh.position.z) / (camera.position.z - bgMesh.position.z)
}
function layout() {
  if (!bgMesh) return
  coverScale()
  const baseW = coverScaleW * 1.24, baseH = coverScaleH * 1.24
  bgMesh.scale.set(baseW, baseH, 1)
  const ft = fitFactor(treeMesh)
  treeMesh.scale.set(baseW * ft, baseH * ft, 1)
  const fk = fitFactor(knightMesh)
  knightMesh.scale.set(baseW * fk, baseH * fk, 1)
}

/* ------------------------------------------------------------- 3D leaves */
const PALETTE = [0xc9962e, 0xa8641c, 0xd9a73a, 0x8a4a14, 0xe0b24a, 0x7a3a10]
function leafTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.translate(32, 32)
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(0, -26)
  g.bezierCurveTo(20, -14, 20, 14, 0, 26)
  g.bezierCurveTo(-20, 14, -20, -14, 0, -26)
  g.closePath(); g.fill()
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2
  g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 24); g.stroke()
  const t = new THREE.CanvasTexture(c)
  return t
}

const leafTex = leafTexture()
const leafGeo = new THREE.PlaneGeometry(0.32, 0.32)
const leafMats = PALETTE.map(col =>
  new THREE.MeshBasicMaterial({ map: leafTex, color: col, transparent: true, side: THREE.DoubleSide, depthWrite: false })
)

const LEAF_COUNT = reduce ? 18 : (window.innerWidth < 700 ? 34 : 60)
const leaves = []
let emitterReady = false

class Leaf {
  constructor() {
    this.mesh = new THREE.Mesh(leafGeo, leafMats[(Math.random() * leafMats.length) | 0])
    this.mesh.position.z = 0.6 + Math.random() * 1.0   // between bg and knight
    scene.add(this.mesh)
    this.reset(true)
  }
  reset(initial) {
    const tree = uvToWorld(TREE.u, TREE.v)
    // spawn near the tree canopy, drift across the whole top otherwise
    const fromTree = Math.random() < 0.5
    this.mesh.position.x = fromTree
      ? tree.x + (Math.random() - 0.5) * coverScaleW * 0.22
      : (Math.random() - 0.5) * coverScaleW
    this.mesh.position.y = initial
      ? (Math.random() - 0.5) * coverScaleH
      : (fromTree ? tree.y + (Math.random() - 0.3) * coverScaleH * 0.15
                  : coverScaleH * 0.5 + Math.random() * 1.5)
    const s = 0.6 + Math.random() * 1.1
    this.mesh.scale.setScalar(s)
    this.vy = 0.4 + Math.random() * 0.7
    this.sway = 0.4 + Math.random() * 0.8
    this.amp = 0.3 + Math.random() * 0.7
    this.phase = Math.random() * Math.PI * 2
    this.rot = new THREE.Vector3(
      (Math.random() - 0.5) * 0.04,
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.05
    )
  }
  step(t, dt, wind) {
    const p = this.mesh.position
    p.y -= (this.vy + Math.abs(wind) * 0.3) * dt
    p.x += (Math.sin(t * this.sway + this.phase) * this.amp * 0.4 + wind) * dt
    this.mesh.rotation.x += this.rot.x
    this.mesh.rotation.y += this.rot.y
    this.mesh.rotation.z += this.rot.z + wind * 0.01 * dt
    if (p.y < -coverScaleH * 0.6 || p.x < -coverScaleW * 0.7 || p.x > coverScaleW * 0.7) this.reset(false)
  }
}

/* ------------------------------------------------------------- parallax */
let mx = 0, my = 0, cxp = 0, cyp = 0
if (!reduce) {
  window.addEventListener('mousemove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2
    my = (e.clientY / window.innerHeight - 0.5) * 2
  })
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return
    mx = Math.max(-1, Math.min(1, e.gamma / 30))
    my = Math.max(-1, Math.min(1, (e.beta - 45) / 30))
  })
}

/* ----------------------------------------------------------- wind gusts */
let wind = 0, windTarget = -0.3
function gust() {
  windTarget = -(0.1 + Math.random() * 1.4)
  setTimeout(gust, 2200 + Math.random() * 3800)
}
gust()

/* -------------------------------------------------------------- render */
const clock = new THREE.Clock()
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const t = clock.elapsedTime
  wind += (windTarget - wind) * 0.02

  if (emitterReady) {
    if (leaves.length < LEAF_COUNT) leaves.push(new Leaf())
    for (const l of leaves) l.step(t, dt, wind)

    // parallax: ease camera, layers at different z shift by different amounts
    cxp += (mx - cxp) * 0.05
    cyp += (my - cyp) * 0.05
    camera.position.x = cxp * 1.2
    camera.position.y = -cyp * 0.8
    camera.lookAt(0, 0, 0)
    // subtle idle breathing on the knight, gentle wind sway on the tree
    if (knightMesh) knightMesh.position.y = Math.sin(t * 0.6) * 0.04
    if (treeMesh) treeMesh.rotation.z = Math.sin(t * 0.5) * 0.012 + wind * 0.01
  }
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

/* --------------------------------------------------------------- intro */
function intro() {
  gsap.to(bgMesh.material, { opacity: 1, duration: 1.4, ease: 'power2.out' })
  gsap.to(treeMesh.material, { opacity: 1, duration: 1.4, ease: 'power2.out', delay: 0.15 })
  gsap.to(knightMesh.material, { opacity: 1, duration: 1.4, ease: 'power2.out', delay: 0.2 })

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
  // links drop in like falling leaves: from above, drifting + rotating, settle with bounce
  tl.fromTo('.links a',
    { y: -110, x: () => (Math.random() - 0.5) * 60, opacity: 0, rotation: () => (Math.random() - 0.5) * 40 },
    { y: 0, x: 0, opacity: 1, rotation: 0, duration: 1.0, stagger: 0.14, ease: 'bounce.out' }, 0.5)
  tl.fromTo('footer', { opacity: 0 }, { opacity: 1, duration: 0.5 }, '-=0.3')
  tl.fromTo('.sign', { opacity: 0, y: 14 }, { opacity: 0.85, y: 0, duration: 1.0 }, '-=0.4')
}

/* --------------------------------------------------------------- boot */
window.addEventListener('resize', resize)
resize()
loader.load('/knight.webp', (tex) => buildScene(tex, tex.image))
requestAnimationFrame(tick)

/* -------------------------------------------------------------- audio */
const audio = document.querySelector('#theme')
const btn = document.querySelector('#sound')
audio.volume = 0
const setOn = (on) => { btn.dataset.on = on ? 'true' : 'false' }
function play() {
  audio.play().then(() => { setOn(true); gsap.to(audio, { volume: 0.45, duration: 1.5 }) })
    .catch(() => setOn(false))
}
let started = false
function firstGesture() {
  if (started) return
  started = true
  play()
  window.removeEventListener('pointerdown', firstGesture)
  window.removeEventListener('keydown', firstGesture)
}
window.addEventListener('pointerdown', firstGesture)
window.addEventListener('keydown', firstGesture)
btn.addEventListener('click', (e) => {
  e.stopPropagation()
  if (audio.paused || btn.dataset.on === 'false') { started = true; play() }
  else gsap.to(audio, { volume: 0, duration: 0.6, onComplete: () => { audio.pause(); setOn(false) } })
})
