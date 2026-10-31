// Generic runtime: renderer, camera, controls, notes, UI, window.__tour.
// Normally unchanged between explainers (scene = world.js, content = story JSON).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import storyJson from 'tour-data';
import { applyTheme, color, SC, STYLE } from './theme.js';
import { loadStory, evalBeat, blend, ease, schedule, timedState, resolveState } from './story.js';
import { buildWorld } from 'tour-world';

applyTheme();
const story = loadStory(storyJson);
const beats = story.beats;
const sched = schedule(beats);
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
if (params.get('ui') === '0') document.body.classList.add('noui');
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ---------- renderer / scene ----------
const view = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(color('bg'), 1);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(SC.fov, 1, SC.near, SC.far);
scene.add(new THREE.HemisphereLight(0xffffff, color('ground'), 2.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xdbe8ff, 0.35);
fill.position.set(-40, 30, -30);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: SC.shadowOpacity }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0.001;
floor.receiveShadow = true;
scene.add(floor);

const world = buildWorld();
scene.add(world.root);

const controls = new OrbitControls(camera, renderer.domElement);
controls.minDistance = SC.minDistance;
controls.maxDistance = SC.maxDistance;
controls.maxPolarAngle = Math.PI * 0.49;
let userCam = false;
controls.addEventListener('start', () => { userCam = true; });

// ---------- camera helpers ----------
const tmpV = new THREE.Vector3();
function resolve(spec) {
  if (Array.isArray(spec)) return spec;
  const p = world.parts[spec.part];
  if (!p) return [0, 0, 0];
  p.getWorldPosition(tmpV);
  const off = spec.off || [0, 0, 0];
  return [tmpV.x + off[0], tmpV.y + off[1], tmpV.z + off[2]];
}
const fit = () => Math.min(SC.maxFit, Math.max(1, SC.refAspect / camera.aspect));
function applyCam(c) {
  const d = c.dist * fit();
  const [tx, ty, tz] = c.target;
  camera.position.set(tx + d * Math.cos(c.el) * Math.sin(c.az), ty + d * Math.sin(c.el), tz + d * Math.cos(c.el) * Math.cos(c.az));
  controls.target.set(tx, ty, tz);
  camera.lookAt(controls.target);
}
function camFromView() {
  const t = controls.target;
  const d = camera.position.clone().sub(t);
  const dist = d.length();
  return { az: Math.atan2(d.x, d.z), el: Math.asin(d.y / dist), dist: dist / fit(), target: t.toArray() };
}

function resize() {
  const w = view.clientWidth || window.innerWidth, h = view.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, h * SC.viewLift, w, h); // lift the scene a little
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

// ---------- UI ----------
const hdr = $('header'), bar = $('#bar'), notesBox = $('#notes'), leaders = $('#leaders');
const capCh = $('#caption .ch'), capTx = $('#caption .tx'), caption = $('#caption');
$('h1').textContent = story.title;
document.title = story.title;
const firstOfChapter = story.chapters.map((_, ci) => beats.findIndex((b) => b.chapter === ci));
const chips = story.chapters.map((title, ci) => {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = title;
  b.onclick = () => goTo(firstOfChapter[ci]);
  $('#chips').appendChild(b);
  return b;
});
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
};
$('#prev').onclick = () => goTo(cur - 1);
$('#next').onclick = () => goTo(cur + 1);
$('#play').onclick = () => setPlaying(!playing);
let textMode = store.get('tour.text', STYLE.text.default || 'full');
const aa = $('#aa');
const syncAa = () => { caption.classList.toggle('short', textMode === 'short'); aa.title = textMode === 'short' ? 'Short text' : 'Full text'; };
aa.onclick = () => { textMode = textMode === 'short' ? 'full' : 'short'; store.set('tour.text', textMode); lastText = null; syncAa(); };
syncAa();
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') goTo(cur + 1);
  else if (e.key === 'ArrowLeft') goTo(cur - 1);
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
});

let dotsChapter = -1;
function syncUI(S) {
  const b = beats[S.beat];
  chips.forEach((c, i) => c.classList.toggle('on', i === b.chapter));
  if (dotsChapter !== b.chapter) {
    dotsChapter = b.chapter;
    const dots = $('#dots');
    dots.innerHTML = '';
    beats.forEach((x) => {
      if (x.chapter !== b.chapter) return;
      const d = document.createElement('button');
      d.className = 'dot';
      d.dataset.i = x.index;
      d.onclick = () => goTo(x.index);
      dots.appendChild(d);
    });
  }
  for (const d of $('#dots').children) d.classList.toggle('on', +d.dataset.i === S.beat);
}

let lastText = null;
function drawCaption(S) {
  const t = textMode === 'short' ? S.short : S.text;
  const key = S.beat + '|' + t;
  if (key !== lastText) { lastText = key; capCh.textContent = beats[S.beat].chapterTitle; capTx.textContent = t; }
  caption.style.opacity = S.textAlpha;
  caption.style.visibility = t ? 'visible' : 'hidden';
}

// ---------- annotations ----------
const noteEls = new Map();
const ray = new THREE.Raycaster();
const nv = new THREE.Vector3(), nd = new THREE.Vector3();
function drawNotes(S) {
  const W = view.clientWidth, H = view.clientHeight;
  const noui = document.body.classList.contains('noui');
  const top = noui ? 8 : hdr.getBoundingClientRect().bottom + 8;
  const bottom = noui ? H - 8 : bar.getBoundingClientRect().top - 8;
  const occ = world.occluders();
  const seen = new Set();
  let svg = '';
  for (const n of S.notes) {
    const key = n.id ?? `${n.part}|${n.tag}`;
    seen.add(key);
    let el = noteEls.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'note';
      el.innerHTML = '<div class="tag"></div><div class="txt"></div><div class="sub"></div>';
      el.children[0].textContent = n.tag || '';
      el.children[1].textContent = n.text || '';
      el.children[2].textContent = n.sub || '';
      notesBox.appendChild(el);
      noteEls.set(key, el);
    }
    const p = world.parts[n.part];
    if (!p) { el.style.opacity = 0; continue; }
    nv.set(...(n.at || [0, 0, 0]));
    p.localToWorld(nv);
    nd.copy(nv).sub(camera.position);
    const dist = nd.length();
    ray.set(camera.position, nd.normalize());
    ray.far = Math.max(0, dist - 0.15);
    const occluded = ray.intersectObjects(occ, false).length > 0;
    nv.project(camera);
    if (nv.z > 1) { el.style.opacity = 0; continue; }
    const ax = ((nv.x + 1) / 2) * W, ay = ((1 - nv.y) / 2) * H;
    const [dx, dy] = n.off || [40, -50];
    const ew = el.offsetWidth, eh = el.offsetHeight;
    let lx = dx < 0 ? ax + dx - ew : ax + dx;
    let ly = ay + dy - eh / 2;
    lx = Math.min(Math.max(lx, 8), W - 8 - ew);
    ly = Math.min(Math.max(ly, top), bottom - eh);
    const alpha = n.alpha * (occluded ? 0.25 : 1);
    el.style.transform = `translate(${lx}px,${ly}px)`;
    el.style.opacity = alpha;
    const ex = ax < lx + ew / 2 ? lx : lx + ew, ey = ly + eh / 2;
    svg += `<g opacity="${alpha.toFixed(3)}"><line x1="${ax}" y1="${ay}" x2="${ex}" y2="${ey}"/><circle cx="${ax}" cy="${ay}" r="3"/></g>`;
  }
  for (const [k, el] of noteEls) if (!seen.has(k)) { el.remove(); noteEls.delete(k); }
  leaders.innerHTML = svg;
}

// ---------- playback state ----------
let mode = params.has('t') ? 'timed' : 'interactive';
let seekT = +params.get('t') || 0;
let cur = Math.min(beats.length - 1, Math.max(0, +params.get('beat') || 0));
const DEFAULT_T = 2;
let A = null, transStart = 0, transDur = 0, playing = false, lastS = null;
const frameWaiters = [];

function setPlaying(v) {
  playing = v;
  $('#play').innerHTML = v ? ICON.pause : ICON.play;
  if (v) {
    if (mode === 'timed') mode = 'interactive';
    if (cur === beats.length - 1) goTo(0, true);
    else transStart = Math.min(transStart, performance.now() - transDur); // start hold now
  }
}
function snapshot() {
  const S = lastS || resolveState(evalBeat(beats[cur]), resolve);
  return userCam ? { ...S, cam: camFromView() } : S;
}
function goTo(i, fromPlay = false) {
  i = Math.min(beats.length - 1, Math.max(0, i));
  if (!fromPlay) setPlaying(false);
  A = snapshot();
  mode = 'interactive';
  cur = i;
  transStart = performance.now();
  transDur = Math.max(800, (beats[i].transition || DEFAULT_T) * 1000);
  userCam = false;
}
function renderFrame(now) {
  world.root.updateMatrixWorld(true);
  let S, wt;
  if (mode === 'timed') {
    S = timedState(beats, seekT, resolve, sched).S;
    wt = seekT;
  } else {
    const B = resolveState(evalBeat(beats[cur]), resolve);
    const e = transDur > 0 ? Math.min(1, (now - transStart) / transDur) : 1;
    S = A && e < 1 ? blend(A, B, ease(e)) : B;
    wt = now / 1000;
    if (playing && e >= 1 && now - transStart - transDur > beats[cur].duration * 1000) {
      if (cur < beats.length - 1) goTo(cur + 1, true);
      else setPlaying(false);
    }
  }
  lastS = S;
  if (!userCam) applyCam(S.cam);
  world.update(S, wt);
  world.root.updateMatrixWorld(true);
  renderer.render(scene, camera);
  drawNotes(S);
  drawCaption(S);
  syncUI(S);
  for (const f of frameWaiters.splice(0)) f();
}
let manual = false; // video capture: render only on seek, no rAF loop
function loop(now) { if (manual) return; requestAnimationFrame(loop); renderFrame(now); }
setPlaying(false);
requestAnimationFrame(loop);

// ---------- video / automation API ----------
window.__tour = {
  duration: sched.duration,
  beats: beats.length,
  starts: sched.starts,
  transitions: beats.map((b) => b.transition),
  goTo: (i) => goTo(i),
  /** Deterministic: state and world time both come from t (seconds). */
  seek(t) { setPlaying(false); mode = 'timed'; seekT = t; userCam = false; if (manual) renderFrame(performance.now()); },
  /** Stop the render loop; each seek(t) then renders exactly one frame (fast capture). */
  setManual(v) { const was = manual; manual = !!v; if (was && !manual) requestAnimationFrame(loop); },
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  /** Resolves after the next rendered frame. */
  frame: () => new Promise((r) => frameWaiters.push(r)),
  ready: false,
};
window.__tour.frame().then(() => { window.__tour.ready = true; });
