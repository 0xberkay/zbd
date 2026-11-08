import './style.css'
import * as THREE from 'three'
import gsap from 'gsap'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const mobile = window.innerWidth < 700 || window.matchMedia('(pointer: coarse)').matches
const canvas = document.querySelector('#scene')

/* -------------------------------------------------------------- renderer */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' })
// quality tiers, stepped down automatically when frames run slow
const DPR_MAX = Math.min(window.devicePixelRatio, mobile ? 1.25 : 1.5)
let quality = mobile ? 1 : 2
renderer.setPixelRatio(DPR_MAX)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.setClearColor(0x140d04, 1)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
const CAM_Z = 10
camera.position.set(0, 0, CAM_Z)

/* ------------------------------------------------------------ composer */
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.78)
bloom.enabled = !mobile
composer.addPass(bloom)

// lens: chromatic aberration toward edges + vignette + film grain
const lens = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uCA: { value: 0.0012 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uCA, uFlash;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * uCA * 18.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float vig = smoothstep(0.95, 0.18, r2 * 2.1);
      c *= mix(0.42, 1.0, vig) + uFlash * 0.25;
      float n = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.0) - 0.5;
      c += n * 0.035;
      gl_FragColor = vec4(c, 1.0);
    }`,
})
composer.addPass(lens)
composer.addPass(new OutputPass())

/* --------------------------------------------------------------- layout */
const PLANE_Z = -3            // undisplaced photo plane
const STRENGTH = mobile ? 3.8 : 4.5  // depth pop-out in world units
const OVERSCAN = 1.22
let vW = 0, vH = 0, imgAspect = 2482 / 1696
let coverW = 1, coverH = 1, focusX = 0

function visibleAt(z) {
  const dist = camera.position.z - z
  const h = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * dist
  return { w: h * camera.aspect, h }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
  bloom.resolution.set(w / 4, h / 4)
  layout()
}

/* ------------------------------------------------ hand-built depth map */
// Image composition traced on a 1200x820 reference of knight.webp.
const REF_W = 1200, REF_H = 820
const KNIGHT_POLY = [
  [262, 118], [294, 118], [286, 258], [306, 262], [306, 276], [288, 280],
  [345, 252], [378, 186], [420, 170], [456, 188], [468, 240], [450, 266],
  [484, 286], [508, 322], [515, 382], [532, 440], [548, 470], [548, 520],
  [584, 560], [614, 590], [616, 632], [562, 652], [420, 662], [300, 644],
  [160, 604], [138, 520], [172, 420], [198, 340], [232, 296], [238, 278],
  [208, 272], [208, 262], [258, 260],
]
const TREE = { cx: 980, cy: 238, rx: 92, ry: 64, trunk: [966, 268, 26, 64] }
const HORIZON = 0.39 // fraction of image height

function mk(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return [c, c.getContext('2d')]
}
// portable blur (Safari lacks ctx.filter): downsample + bilinear upsample
function softBlur(src, factor) {
  const [s, sg] = mk(Math.max(1, (src.width / factor) | 0), Math.max(1, (src.height / factor) | 0))
  sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high'
  sg.drawImage(src, 0, 0, s.width, s.height)
  const [o, og] = mk(src.width, src.height)
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high'
  og.drawImage(s, 0, 0, o.width, o.height)
  return o
}
function tracePoly(g, pts, sx, sy) {
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * sx, y * sy) : g.moveTo(x * sx, y * sy)))
  g.closePath()
}
function traceTree(g, sx, sy) {
  g.beginPath()
  g.ellipse(TREE.cx * sx, TREE.cy * sy, TREE.rx * sx, TREE.ry * sy, 0, 0, Math.PI * 2)
  const [tx, ty, tw, th] = TREE.trunk
  g.rect(tx * sx, ty * sy, tw * sx, th * sy)
}
const gray = (v) => { const n = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${n},${n},${n})` }

function buildDepth() {
  const w = 512, h = Math.round(512 / imgAspect)
  const sx = w / REF_W, sy = h / REF_H
  const [c, g] = mk(w, h)

  // sky -> horizon -> foreground ramp
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, gray(0.0))
  grd.addColorStop(HORIZON * 0.8, gray(0.06))
  grd.addColorStop(HORIZON, gray(0.13))
  for (let i = 1; i <= 8; i++) {
    const t = i / 8
    grd.addColorStop(HORIZON + (1 - HORIZON) * t, gray(0.13 + 0.87 * Math.pow(t, 1.25)))
  }
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)

  // volumetric clouds: soft blobs in the sky
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * w, y = Math.random() * h * HORIZON * 0.9, r = 18 + Math.random() * 60
    const rg = g.createRadialGradient(x, y, 0, x, y, r)
    rg.addColorStop(0, 'rgba(255,255,255,0.05)')
    rg.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = rg
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // grass tufts: bumpy foreground
  for (let i = 0; i < 2200; i++) {
    const y = h * HORIZON + Math.random() * h * (1 - HORIZON)
    const near = (y / h - HORIZON) / (1 - HORIZON)
    const x = Math.random() * w
    g.fillStyle = `rgba(255,255,255,${0.02 + near * 0.05})`
    g.beginPath()
    g.ellipse(x, y, 1 + near * 3, 2 + near * 9, (Math.random() - 0.5) * 0.6, 0, Math.PI * 2)
    g.fill()
  }
  g.globalCompositeOperation = 'source-over'

  // tree on the far ridge
  g.fillStyle = gray(0.24)
  traceTree(g, sx, sy); g.fill()

  // knight: flat base + pillow so the armour is rounded, not cardboard
  g.fillStyle = gray(0.66)
  tracePoly(g, KNIGHT_POLY, sx, sy); g.fill()
  const [p, pg] = mk(w, h)
  pg.fillStyle = '#fff'
  tracePoly(pg, KNIGHT_POLY, sx, sy); pg.fill()
  const pillow = softBlur(softBlur(p, 10), 6)
  g.save()
  tracePoly(g, KNIGHT_POLY, sx, sy); g.clip()
  g.globalCompositeOperation = 'lighter'
  g.globalAlpha = 0.28
  g.drawImage(pillow, 0, 0)
  g.restore()

  const depth = softBlur(softBlur(c, 3), 2)

  // object mask (knight + tree) -> green channel, stops grass sway on them
  const [m, mg] = mk(w, h)
  mg.fillStyle = '#000'; mg.fillRect(0, 0, w, h)
  mg.fillStyle = '#fff'
  tracePoly(mg, KNIGHT_POLY, sx, sy); mg.fill()
  traceTree(mg, sx, sy); mg.fill()
  const mask = softBlur(m, 4)

  const d = depth.getContext('2d').getImageData(0, 0, w, h)
  const md = mask.getContext('2d').getImageData(0, 0, w, h).data
  for (let i = 0; i < d.data.length; i += 4) { d.data[i + 1] = md[i]; d.data[i + 2] = 0; d.data[i + 3] = 255 }
  const [o, og] = mk(w, h)
  og.putImageData(d, 0, 0)
  const tex = new THREE.CanvasTexture(o)
  tex.colorSpace = THREE.NoColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return { tex, texel: new THREE.Vector2(1 / w, 1 / h) }
}

/* -------------------------------------------------- displaced photo mesh */
const U = {
  uMap: { value: null },
  uDepth: { value: null },
  uDepthTexel: { value: new THREE.Vector2() },
  uImgTexel: { value: new THREE.Vector2() },
  uStrength: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: 0 },
  uFlash: { value: 0 },
  uFlashUv: { value: new THREE.Vector2(0.74, 0.84) },
  uLantern: { value: new THREE.Vector2(0.35, 0.4) },
  uLanternOn: { value: 0 },
  uReveal: { value: 0 },
  uAspect: { value: imgAspect },
  uDist: { value: CAM_Z - PLANE_Z },
}

const photoVert = /* glsl */`
  uniform sampler2D uDepth; uniform float uStrength, uTime, uWind, uDist;
  varying vec2 vUv; varying float vDepth; varying float vMask;
  void main(){
    vUv = uv;
    vec4 d = texture2D(uDepth, uv);
    vDepth = d.r; vMask = d.g;
    vec3 p = position;
    // wind rolling through the grass (not the knight / tree)
    float ground = smoothstep(0.38, 0.8, 1.0 - uv.y) * (1.0 - d.g);
    float wave = sin(uTime * 1.4 + uv.x * 22.0 + uv.y * 7.0) * 0.6
               + sin(uTime * 2.3 - uv.x * 47.0) * 0.3;
    p.x += wave * ground * 0.0018 * (1.0 + abs(uWind) * 1.5);
    p.y += wave * ground * 0.0008;
    // pull toward the camera, then shrink toward the optical axis so the
    // resting frame matches the flat photo (true parallax only when moving)
    vec4 w = modelMatrix * vec4(p, 1.0);
    float dz = d.r * uStrength;
    w.xy *= (uDist - dz) / uDist;
    w.z += dz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const photoFrag = /* glsl */`
  uniform sampler2D uMap, uDepth;
  uniform vec2 uDepthTexel, uImgTexel, uFlashUv, uLantern;
  uniform float uTime, uFlash, uLanternOn, uReveal, uAspect, uWind;
  varying vec2 vUv; varying float vDepth; varying float vMask;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
  float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 grade(vec3 lin){
    vec3 c = pow(max(lin, 0.0), vec3(1.0/2.2));
    c *= 1.95;
    c = (c - 0.5) * 1.03 + 0.5;
    c = mix(vec3(lum(c)), c, 1.22);
    return c;
  }

  void main(){
    vec3 c = grade(texture2D(uMap, vUv).rgb);

    // surface normal: macro from depth map, micro from image luminance (armour detail)
    vec2 ed = uDepthTexel * 3.0, ei = uImgTexel * 8.0;
    float dl = vDepth, dd = vDepth;
    float dr = texture2D(uDepth, vUv + vec2(ed.x, 0)).r, du = texture2D(uDepth, vUv + vec2(0, ed.y)).r;
    float ll = lum(texture2D(uMap, vUv - ei * 0.5).rgb);
    float lr = lum(texture2D(uMap, vUv + vec2(ei.x, 0)).rgb), lu = lum(texture2D(uMap, vUv + vec2(0, ei.y)).rgb);
    float ld = ll;
    vec3 n = normalize(vec3((dl - dr) * 14.0 + (ll - lr) * 2.5, (dd - du) * 14.0 + (ld - lu) * 2.5, 1.0));

    vec2 asp = vec2(uAspect, 1.0);

    // warm lantern following the pointer
    vec2 lv = (uLantern - vUv) * asp;
    float lfall = exp(-dot(lv, lv) * 9.0);
    vec3 L = normalize(vec3(lv, 0.22));
    float ldiff = max(dot(n, L), 0.0);
    vec3 lantern = vec3(1.0, 0.68, 0.3);
    c += c * lantern * ldiff * lfall * 0.9 * uLanternOn;
    c += lantern * 0.02 * lfall * uLanternOn;

    // lightning: cold key light from the storm clouds + sky bloom
    if (uFlash > 0.001) {
    vec2 fv = (uFlashUv - vUv) * asp;
    vec3 F = normalize(vec3(fv, 0.35));
    float fdiff = max(dot(n, F), 0.0);
    float fspec = pow(max(dot(reflect(-F, n), vec3(0,0,1)), 0.0), 24.0) * vMask;
    vec3 cold = vec3(0.72, 0.8, 1.0);
    float sky = (1.0 - smoothstep(0.08, 0.2, vDepth));
    float fnear = exp(-dot(fv, fv) * 2.5);
    c += uFlash * (c * cold * (fdiff * 2.4 + sky * (2.0 + fnear * 5.0)) + cold * fspec * 0.9 + cold * sky * fnear * 0.18);
    }

    // rim light on the knight's silhouette (depth edge)
    float edge = clamp(length(vec2(dl - dr, dd - du)) * 18.0, 0.0, 1.0);
    c += vec3(0.95, 0.7, 0.35) * edge * 0.05 * (0.6 + 0.4 * sin(uTime * 0.7));

    // atmospheric perspective: far = hazier, drifting fog
    float far = 1.0 - smoothstep(0.08, 0.7, vDepth);
    float fog = fbm(vUv * vec2(3.0, 6.0) + vec2(uTime * 0.025 + uWind * 0.02, uTime * 0.008));
    c = mix(c, vec3(0.30, 0.22, 0.17), far * 0.2 * fog);

    // depth reveal: near layers emerge first
    float vis = 1.0 - smoothstep(uReveal * 1.35 - 0.25, uReveal * 1.35, 1.0 - vDepth);
    c *= vis * smoothstep(0.0, 0.25, uReveal);

    gl_FragColor = vec4(pow(max(c, 0.0), vec3(2.2)), 1.0);
    #include <colorspace_fragment>
  }`

let photo
function buildPhoto(img) {
  imgAspect = img.naturalWidth / img.naturalHeight
  U.uAspect.value = imgAspect
  const map = new THREE.Texture(img)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = renderer.capabilities.getMaxAnisotropy()
  map.needsUpdate = true
  const { tex, texel } = buildDepth()
  U.uMap.value = map
  U.uDepth.value = tex
  U.uDepthTexel.value.copy(texel)
  U.uImgTexel.value.set(1 / img.naturalWidth, 1 / img.naturalHeight)

  const seg = mobile ? [150, 104] : [256, 176]
  const geo = new THREE.PlaneGeometry(1, 1, seg[0], seg[1])
  photo = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: photoVert, fragmentShader: photoFrag }))
  photo.position.z = PLANE_Z
  scene.add(photo)
}

/* ------------------------------------------------------------ fog banks */
const fogVert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const fogFrag = /* glsl */`
  uniform float uTime, uSeed, uOpacity, uBand, uWind, uFlash;
  uniform vec3 uColor;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i=0;i<4;i++){ v += a*noise(p); p *= 2.07; a *= 0.5; } return v; }
  void main(){
    float band0 = abs(vUv.y - uBand);
    if (band0 > 0.5 || uOpacity < 0.001) discard;
    vec2 p = vUv * vec2(4.0, 2.0) + vec2(uSeed - uTime * (0.03 + uWind * 0.04), uSeed * 0.3);
    float n = fbm(p + vec2(sin(uTime * 0.05 + p.y), cos(uTime * 0.04 + p.x)) * 0.35);
    float band = exp(-pow((vUv.y - uBand) * 3.2, 2.0));
    float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    float a = smoothstep(0.35, 0.85, n) * band * edge * uOpacity;
    gl_FragColor = vec4(uColor * (1.0 + uFlash * 3.0), a);
  }`
const fogs = []
function buildFog() {
  const defs = [
    { z: -2.3, band: 0.55, op: 0.4, col: 0x4a3a40 },
    { z: -0.9, band: 0.38, op: 0.3, col: 0x5a4430 },
    { z: 1.6, band: 0.12, op: 0.5, col: 0x3a2a1a },
  ]
  for (const d of defs) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: {
        uTime: U.uTime, uWind: U.uWind, uFlash: U.uFlash,
        uSeed: { value: Math.random() * 50 }, uOpacity: { value: 0 },
        uBand: { value: d.band }, uColor: { value: new THREE.Color(d.col) },
      },
      vertexShader: fogVert, fragmentShader: fogFrag,
      transparent: true, depthWrite: false,
    }))
    m.position.z = d.z
    m.userData.op = d.op
    scene.add(m)
    fogs.push(m)
  }
}

function layout() {
  if (!photo) return
  // cover-fit the photo plane at its own depth, with overscan for camera travel
  const v = visibleAt(PLANE_Z)
  coverW = v.h * imgAspect; coverH = v.h
  if (coverW < v.w) { coverW = v.w; coverH = v.w / imgAspect }
  coverW *= OVERSCAN; coverH *= OVERSCAN
  photo.scale.set(coverW, coverH, 1)
  // portrait: slide the knight into frame
  const portrait = camera.aspect < 1
  focusX = portrait ? (0.5 - 0.47) * coverW : 0
  photo.position.x = focusX

  for (const f of fogs) {
    const fv = visibleAt(f.position.z)
    f.scale.set(fv.w * 1.8, fv.h * 1.4, 1)
  }
}

/* ------------------------------------------------------------ fireflies */
let flies
function buildFireflies() {
  const N = reduce ? 30 : (mobile ? 70 : 150)
  const pos = new Float32Array(N * 3), seed = new Float32Array(N), size = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 18
    pos[i * 3 + 1] = -5 + Math.random() * 5.5
    pos[i * 3 + 2] = -2.5 + Math.random() * 7.5
    seed[i] = Math.random() * 100
    size[i] = 0.6 + Math.random() * 1.4
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPx: { value: renderer.getPixelRatio() }, uReveal: U.uReveal },
    vertexShader: /* glsl */`
      attribute float aSeed, aSize; uniform float uTime, uPx; varying float vTw;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.3 + aSeed) * 0.8 + sin(uTime * 0.71 + aSeed * 2.0) * 0.3;
        p.y += sin(uTime * 0.4 + aSeed * 1.7) * 0.5;
        p.z += cos(uTime * 0.25 + aSeed) * 0.6;
        vTw = pow(0.5 + 0.5 * sin(uTime * (1.2 + fract(aSeed) * 2.0) + aSeed * 6.0), 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uPx * 60.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uReveal; varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a = a * a;
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.3) * (0.6 + vTw * 3.5), a * (0.25 + vTw) * smoothstep(0.5, 1.0, uReveal));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  flies = new THREE.Points(g, m)
  scene.add(flies)
}

/* ------------------------------------------------------- 3D leaf volume */
const PALETTE = [0xc9962e, 0xa8641c, 0xd9a73a, 0x8a4a14, 0xe0b24a, 0x7a3a10]
function leafTexture(blur) {
  const [c, g] = mk(64, 64)
  g.translate(32, 32)
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(0, -26)
  g.bezierCurveTo(20, -14, 20, 14, 0, 26)
  g.bezierCurveTo(-20, 14, -20, -14, 0, -26)
  g.closePath(); g.fill()
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2
  g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 24); g.stroke()
  return new THREE.CanvasTexture(blur ? softBlur(softBlur(c, 4), 2) : c)
}
const leafGeo = new THREE.PlaneGeometry(0.32, 0.32)
const leafTexSharp = leafTexture(false), leafTexSoft = leafTexture(true)
const LEAF_COUNT = reduce ? 18 : (mobile ? 36 : 72)
const SOFT_SHARE = 0.2
const leafMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false })
const leafSoftN = Math.round(LEAF_COUNT * SOFT_SHARE)
const leafSharp = new THREE.InstancedMesh(leafGeo, leafMat(leafTexSharp), LEAF_COUNT - leafSoftN)
const leafSoft = new THREE.InstancedMesh(leafGeo, leafMat(leafTexSoft), leafSoftN)
for (const im of [leafSharp, leafSoft]) {
  im.count = 0
  im.frustumCulled = false
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(im)
}
const leaves = []
const dummy = new THREE.Object3D(), tmpColor = new THREE.Color()

class Leaf {
  constructor(soft) {
    this.soft = soft
    this.im = soft ? leafSoft : leafSharp
    this.i = this.im.count++
    this.pos = new THREE.Vector3()
    this.rotE = new THREE.Euler()
    this.reset(true)
  }
  reset(initial) {
    const z = this.soft ? 3.6 + Math.random() * 1.6 : -2.2 + Math.pow(Math.random(), 1.1) * 5.8
    const v = visibleAt(z)
    this.spanX = v.w * 0.75; this.spanY = v.h * 0.65
    this.pos.set(
      initial ? (Math.random() - 0.5) * 2 * this.spanX : this.spanX * (0.3 + Math.random() * 0.7),
      initial ? (Math.random() - 0.5) * 2 * this.spanY : this.spanY * (0.2 + Math.random() * 0.9),
      z)
    this.scale = (0.6 + Math.random() * 1.1) * (this.soft ? 1.3 : 1)
    const near = THREE.MathUtils.clamp((z + 2.2) / 8.6, 0, 1)
    this.vy = (0.35 + Math.random() * 0.6) * (0.7 + near * 1.6)
    this.vx = 0.6 + near * 1.6
    this.sway = 0.4 + Math.random() * 0.8
    this.amp = 0.3 + Math.random() * 0.7
    this.phase = Math.random() * Math.PI * 2
    this.rot = new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3)
    this.im.setColorAt(this.i, tmpColor.setHex(PALETTE[(Math.random() * PALETTE.length) | 0]))
    this.im.instanceColor.needsUpdate = true
  }
  step(t, dt, wind) {
    const p = this.pos
    p.y -= (this.vy + Math.abs(wind) * 0.3) * dt
    p.x += (Math.sin(t * this.sway + this.phase) * this.amp * 0.4 + wind * this.vx) * dt
    p.z += Math.cos(t * this.sway * 0.7 + this.phase) * 0.15 * dt
    this.rotE.x += this.rot.x * dt
    this.rotE.y += this.rot.y * dt
    this.rotE.z += (this.rot.z + wind) * dt
    if (p.y < -this.spanY || p.x < -this.spanX * 1.1 || p.x > this.spanX * 1.2) this.reset(false)
    dummy.position.copy(p)
    dummy.rotation.copy(this.rotE)
    dummy.scale.setScalar(this.scale)
    dummy.updateMatrix()
    this.im.setMatrixAt(this.i, dummy.matrix)
  }
}

/* ------------------------------------------------------------- pointer */
let mx = 0, my = 0, cxp = 0, cyp = 0
const pointer = new THREE.Vector2(), ray = new THREE.Raycaster()
const photoPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -PLANE_Z), hitPt = new THREE.Vector3(), hitUv = new THREE.Vector2()
let pointerSeen = false
const links = document.querySelector('.links')
if (!reduce) {
  window.addEventListener('pointermove', (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2
    my = (e.clientY / window.innerHeight - 0.5) * 2
    pointer.set(mx, -my)
    pointerSeen = true
  })
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return
    mx = Math.max(-1, Math.min(1, e.gamma / 25))
    my = Math.max(-1, Math.min(1, (e.beta - 45) / 25))
  })
}

// per-button 3D tilt + specular sheen
document.querySelectorAll('.links a').forEach((a) => {
  a.addEventListener('pointermove', (e) => {
    const r = a.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    a.style.setProperty('--ty', `${(x - 0.5) * 34}deg`)
    a.style.setProperty('--tx', `${(0.5 - y) * 40}deg`)
    a.style.setProperty('--mx', `${x * 100}%`)
    a.style.setProperty('--my', `${y * 100}%`)
  })
  a.addEventListener('pointerleave', () => {
    a.style.setProperty('--ty', '0deg'); a.style.setProperty('--tx', '0deg')
  })
})

/* -------------------------------------------------- wind + lightning */
let wind = 0, windTarget = -0.3
function gust() {
  windTarget = -(0.1 + Math.random() * 1.4)
  setTimeout(gust, 2200 + Math.random() * 3800)
}
gust()

let shake = 0
function lightning() {
  if (!reduce && photo) {
    U.uFlashUv.value.set(0.55 + Math.random() * 0.35, 0.72 + Math.random() * 0.2)
    const tl = gsap.timeline()
    tl.to(U.uFlash, { value: 1, duration: 0.05 })
      .to(U.uFlash, { value: 0.15, duration: 0.08 })
      .to(U.uFlash, { value: 0.8, duration: 0.04 })
      .to(U.uFlash, { value: 0, duration: 1.1, ease: 'power3.out' })
    shake = 1
    if (Math.random() < 0.35) tl.to(U.uFlash, { value: 0.55, duration: 0.05 }).to(U.uFlash, { value: 0, duration: 0.7 })
  }
  setTimeout(lightning, 6000 + Math.random() * 9000)
}

/* -------------------------------------------------------------- render */
const clock = new THREE.Clock()
let lastRy = NaN, lastRx = NaN
let perfT = 0, perfN = 0, perfSkip = 4 // ignore intro + shader compile
function applyQuality() {
  renderer.setPixelRatio(quality >= 2 ? DPR_MAX : 1)
  composer.setPixelRatio(renderer.getPixelRatio())
  bloom.enabled = quality >= 2 || (quality === 1 && !mobile)
  lens.enabled = quality >= 1
  if (flies) flies.material.uniforms.uPx.value = renderer.getPixelRatio()
}
function watchPerf(raw) {
  if (perfSkip > 0) { perfSkip -= raw; return }
  perfT += raw; perfN++
  if (perfT < 2) return
  const fps = perfN / perfT
  perfT = 0; perfN = 0
  if (fps < 45 && quality > 0) { quality--; applyQuality(); perfSkip = 1 }
}
// stop the loop in background tabs; one loop only when coming back
let rafId = 0
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(rafId)
  if (!document.hidden) { clock.getDelta(); rafId = requestAnimationFrame(tick) }
})
const intro = { z: 16, y: 2.6, tilt: 0.25 }
function tick() {
  const raw = clock.getDelta()
  const dt = Math.min(raw, 0.05)
  if (raw < 0.5) watchPerf(raw)
  const t = clock.elapsedTime
  wind += (windTarget - wind) * 0.02
  U.uTime.value = t
  U.uWind.value = wind
  lens.uniforms.uTime.value = t
  lens.uniforms.uFlash.value = U.uFlash.value

  if (photo) {
    if (leaves.length < LEAF_COUNT && Math.random() < 0.3) leaves.push(new Leaf(leafSoft.count < leafSoftN && leaves.length % 5 === 4))
    for (const l of leaves) l.step(t, dt, wind)
    leafSharp.instanceMatrix.needsUpdate = true
    leafSoft.instanceMatrix.needsUpdate = true

    // camera: big eased parallax + idle orbit + cinematic intro dolly
    cxp += (mx - cxp) * 0.045
    cyp += (my - cyp) * 0.045
    const idleX = reduce ? 0 : Math.sin(t * 0.17) * 0.35
    const idleY = reduce ? 0 : Math.sin(t * 0.23) * 0.18
    shake *= 0.9
    camera.position.x = cxp * 1.9 + idleX + (Math.random() - 0.5) * shake * 0.06
    camera.position.y = -cyp * 1.1 + idleY + intro.y + (Math.random() - 0.5) * shake * 0.06
    camera.position.z = intro.z + Math.sin(t * 0.11) * 0.25
    camera.lookAt(cxp * 0.4 + focusX * 0.0, -cyp * 0.2 + intro.y * 0.3, -2)
    camera.rotateZ(-cxp * 0.035 + intro.tilt)

    // lantern follows the pointer across the displaced surface
    if (pointerSeen) {
      ray.setFromCamera(pointer, camera)
      if (ray.ray.intersectPlane(photoPlane, hitPt)) {
        hitUv.set((hitPt.x - photo.position.x) / coverW + 0.5, (hitPt.y - photo.position.y) / coverH + 0.5)
        U.uLantern.value.lerp(hitUv, 0.15)
      }
    } else {
      U.uLantern.value.set(0.36 + Math.sin(t * 0.3) * 0.08, 0.55 + Math.sin(t * 0.4) * 0.05)
    }


    const ry = Math.round(cxp * 140) / 10, rx = Math.round((-cyp * 10 + 4) * 10) / 10
    if (ry !== lastRy || rx !== lastRx) {
      lastRy = ry; lastRx = rx
      links.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`
    }
  }
  composer.render()
  rafId = requestAnimationFrame(tick)
}

/* --------------------------------------------------------------- intro */
function startIntro() {
  if (reduce) { intro.z = CAM_Z; intro.y = 0; intro.tilt = 0 }
  gsap.to(intro, { z: CAM_Z, y: 0, tilt: 0, duration: 3.4, ease: 'expo.out' })
  gsap.to(U.uReveal, { value: 1, duration: 2.6, ease: 'power2.inOut' })
  gsap.fromTo(U.uStrength, { value: 0 }, { value: STRENGTH, duration: 3.2, ease: 'elastic.out(1, 0.6)', delay: 0.3 })
  gsap.to(U.uLanternOn, { value: 1, duration: 2, delay: 1.2 })
  fogs.forEach((f, i) => gsap.to(f.material.uniforms.uOpacity, { value: f.userData.op, duration: 3, delay: 0.6 + i * 0.3 }))

  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
  tl.fromTo('.links a',
    { z: -600, y: 80, rotationX: () => -70 - Math.random() * 40, rotationY: () => (Math.random() - 0.5) * 120, opacity: 0 },
    { z: 0, y: 0, rotationX: 0, rotationY: 0, opacity: 1, duration: 1.4, stagger: 0.11, ease: 'back.out(1.6)', clearProps: 'transform' }, 1.4)
  tl.fromTo('.sign', { opacity: 0, y: 14 }, { opacity: 0.85, y: 0, duration: 1.0 }, '-=0.4')
  setTimeout(lightning, 3500)
}

/* --------------------------------------------------------------- boot */
window.addEventListener('resize', resize)
resize()
const img = new Image()
img.decoding = 'async'
img.onload = () => {
  buildPhoto(img)
  buildFog()
  buildFireflies()
  layout()
  startIntro()
}
img.src = mobile ? '/knight-mobile.webp' : '/knight.webp'
rafId = requestAnimationFrame(tick)

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
