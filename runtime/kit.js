// Reusable scene-building helpers. Scene-specific code lives in world.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, SC } from './theme.js';

export { mergeGeometries };
export const lerp = (a, b, e) => a + (b - a) * e;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Chamfered box with its origin at the bottom centre. */
export const rbox = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)).translate(0, h / 2, 0);
/** Plain box with its origin at the bottom centre. */
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
/** Vertical cylinder with its origin at the bottom centre. */
export const cyl = (r, h, seg = 20, rTop = r) => new THREE.CylinderGeometry(rTop, r, h, seg).translate(0, h / 2, 0);
/** Merge copies of geo placed at [x,y,z] points. */
export const scatter = (geo, pts) => mergeGeometries(pts.map((p) => geo.clone().translate(...p)));

export function createKit() {
  const root = new THREE.Group();
  const parts = {};
  const solids = []; // meshes that can hide annotations
  const meshes = []; // every registered mesh (for highlight)
  const ghostC = color('ghost');

  /** Named part Group. parent = Group or part name. */
  function part(name, parent = root, pos = [0, 0, 0]) {
    const g = new THREE.Group();
    g.name = name;
    g.userData.partName = name;
    g.userData.meshes = [];
    g.position.set(...pos);
    (typeof parent === 'string' ? parts[parent] : parent).add(g);
    parts[name] = g;
    return g;
  }

  /** Mesh with edge outline, registered for highlight + occlusion.
   *  o: {pos, rot, scale, edges, shadow, occ, flat, roughness, metalness, emissive} */
  function solid(group, geo, col = 'part', o = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: color(col), roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0,
      flatShading: !!o.flat, transparent: !!o.transparent,
    });
    const m = new THREE.Mesh(geo, mat);
    if (o.pos) m.position.set(...o.pos);
    if (o.rot) m.rotation.set(...o.rot);
    if (o.scale) m.scale.set(...o.scale);
    m.castShadow = o.shadow !== false;
    m.receiveShadow = true;
    m.userData.base = mat.color.clone();
    m.userData.fade = 1;
    if (o.edges !== false) {
      const em = new THREE.LineBasicMaterial({ color: color('edge'), transparent: true, opacity: SC.edgeOpacity });
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, o.edgeAngle ?? 30), em);
      e.raycast = () => {};
      m.add(e);
      m.userData.edge = e;
    }
    group.add(m);
    (group.userData.meshes ||= []).push(m);
    meshes.push(m);
    if (o.occ !== false) solids.push(m);
    return m;
  }

  /** After building: store the part-name chain of each mesh. */
  function finalize() {
    for (const m of meshes) {
      const chain = [];
      for (let p = m.parent; p; p = p.parent) if (p.userData.partName) chain.push(p.userData.partName);
      m.userData.chain = chain;
    }
  }

  /** Highlight = ghosting: non-highlighted colours lerp toward ghost.
   *  Also applies userData.fade (set by world.update) to mesh + edges. */
  function applyLook(h = {}) {
    const strength = Math.max(0, ...Object.values(h));
    for (const m of meshes) {
      let v = 0;
      for (const n of m.userData.chain) v = Math.max(v, h[n] ?? 0);
      const mix = SC.ghostMix * strength * (1 - v);
      m.material.color.copy(m.userData.base).lerp(ghostC, mix);
      const f = m.userData.fade;
      if (m.material.transparent) m.material.opacity = f;
      if (m.userData.edge) m.userData.edge.material.opacity = SC.edgeOpacity * f * (1 - 0.8 * mix);
    }
  }

  /** Meshes that currently hide annotations. */
  function occluders() {
    return solids.filter((m) => {
      if (m.userData.fade < 0.3) return false;
      for (let p = m; p; p = p.parent) if (!p.visible) return false;
      return true;
    });
  }

  return { root, parts, solids, meshes, part, solid, finalize, applyLook, occluders };
}

/** Constant-speed polyline with dwell times.
 *  keys: [{p:[x,y,z], dwell:s}]. at(t) -> {pos, key, dwell, f, progress}. */
export function makePath(keys, speed = 2) {
  const pts = keys.map((k) => new THREE.Vector3(...(k.p ?? k)));
  const segs = [];
  const dwellStart = [];
  let T = 0;
  pts.forEach((p, i) => {
    const d = keys[i].dwell ?? 0;
    dwellStart[i] = T;
    if (d > 0) { segs.push({ t0: T, t1: T + d, a: p, b: p, key: i, dwell: true }); T += d; }
    if (i < pts.length - 1) {
      const dt = p.distanceTo(pts[i + 1]) / speed;
      segs.push({ t0: T, t1: T + dt, a: p, b: pts[i + 1], key: i, dwell: false });
      T += dt;
    }
  });
  const out = new THREE.Vector3();
  return {
    period: T,
    dwellStart,
    at(time) {
      const tt = ((time % T) + T) % T;
      const s = segs.find((x) => tt < x.t1) || segs[segs.length - 1];
      const f = s.t1 > s.t0 ? (tt - s.t0) / (s.t1 - s.t0) : 0;
      out.lerpVectors(s.a, s.b, f);
      return { pos: out, key: s.key, dwell: s.dwell, f, progress: tt / T };
    },
  };
}

/** Moving items on a path (InstancedMesh). Items are evenly spaced in time.
 *  stage(r) -> {hidden, scale:[x,y,z], spin, color:THREE.Color} */
export function flow(parent, path, { count = 8, geo, stage, roughness = 0.6 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness });
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color(1, 1, 1);
  for (let i = 0; i < count; i++) im.setColorAt(i, C);
  parent.add(im);
  return {
    mesh: im,
    spacing: path.period / count,
    update(t, amount = 1) {
      for (let i = 0; i < count; i++) {
        const r = path.at(t + (i * path.period) / count);
        const st = stage ? stage(r) : {};
        const s = st.hidden || amount < 0.01 ? 0 : amount;
        const sc = st.scale || [1, 1, 1];
        E.set(0, st.spin ?? 0, 0);
        Q.setFromEuler(E);
        V.set(sc[0] * s, sc[1] * s, sc[2] * s);
        M.compose(r.pos, Q, V);
        im.setMatrixAt(i, M);
        im.setColorAt(i, st.color || C.setRGB(1, 1, 1));
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
    },
  };
}

/** Low-poly trees merged in one mesh. spots: [[x, z, scale]] */
export function trees(kit, group, spots) {
  const crowns = [], trunks = [];
  for (const [x, z, s = 1] of spots) {
    crowns.push(new THREE.ConeGeometry(1.3 * s, 3.2 * s, 7).translate(x, 0.9 * s + 1.6 * s, z));
    trunks.push(new THREE.CylinderGeometry(0.15 * s, 0.2 * s, 0.9 * s, 6).translate(x, 0.45 * s, z));
  }
  kit.solid(group, mergeGeometries(crowns), 'tree', { flat: true, occ: false, edges: false });
  kit.solid(group, mergeGeometries(trunks), 'partDark', { flat: true, occ: false, edges: false });
}
