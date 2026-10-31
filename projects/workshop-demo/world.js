// SCENE-SPECIFIC: replace this file for each new explainer.
// Demo: a small workshop (site -> building -> machines) with a material flow:
// raw block -> press (flattens) -> oven (fires, white -> dark) -> rack.
import * as THREE from 'three';
import { createKit, rbox, box, cyl, scatter, makePath, flow, trees, lerp, clamp01 } from '../../runtime/kit.js';
import { color } from '../../runtime/theme.js';

export function buildWorld() {
  const K = createKit();
  const { part, solid } = K;

  // ---------- site ----------
  const site = part('site');
  solid(site, box(72, 0.2, 48).translate(0, -0.2, 0), 'lawn', { occ: false, edges: false, shadow: false });
  solid(site, box(36, 0.06, 24), 'apron', { occ: false, edges: false, shadow: false });
  solid(site, box(72, 0.08, 5).translate(0, 0, 18.5), 'road', { occ: false, edges: false, shadow: false });
  const dashes = [];
  for (let x = -34; x <= 34; x += 4) dashes.push([x, 0.08, 18.5]);
  solid(site, scatter(box(2, 0.02, 0.22), dashes), 'bg', { occ: false, edges: false, shadow: false });
  trees(K, site, [
    [-30, -18, 1.1], [-25, -20, 0.9], [-20, -19, 1.2], [-31, -8, 1], [-30, 4, 0.9],
    [26, -19, 1.2], [31, -14, 0.9], [30, -2, 1.1], [24, -21, 0.8], [31, 8, 1],
  ]);

  // utilities: two tanks + pipe to the building
  const util = part('utilities', site, [19, 0, -5]);
  solid(util, cyl(1.3, 4.5, 24), 'part', { pos: [0, 0, 0] });
  solid(util, cyl(1.3, 4.5, 24), 'part', { pos: [0, 0, 3.2] });
  const pipe = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([[0, 3.6, 1.6], [-2.5, 3.6, 1.6], [-5.6, 3.6, 1.6]].map((p) => new THREE.Vector3(...p))), 8, 0.16, 8);
  solid(util, pipe, 'partDark', { edges: false });

  // delivery truck
  const truck = part('truck', site, [-9, 0, 13.2]);
  solid(truck, rbox(6.2, 2.7, 2.4, 0.08).translate(0, 0.7, 0), 'part', { pos: [-0.8, 0, 0] });
  solid(truck, rbox(1.8, 2.2, 2.3, 0.15).translate(0, 0.7, 0), 'accent', { pos: [3.4, 0, 0] });
  const wheel = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16).rotateX(Math.PI / 2);
  solid(truck, scatter(wheel, [[-2.8, 0.45, 1.1], [-2.8, 0.45, -1.1], [-0.6, 0.45, 1.1], [-0.6, 0.45, -1.1], [3.4, 0.45, 1.1], [3.4, 0.45, -1.1]]), 'belt', { edges: false });

  // ---------- building ----------
  const W = 26, D = 14, H = 4, T = 0.3;
  const bld = part('building', site);
  solid(bld, rbox(W + 0.8, 0.3, D + 0.8, 0.05), 'partDark', { occ: false });

  const walls = part('walls', bld, [0, 0.3, 0]);
  solid(walls, box(W, H, T), 'part', { pos: [0, 0, -D / 2 + T / 2] });
  solid(walls, box(W, H, T), 'part', { pos: [0, 0, D / 2 - T / 2] });
  solid(walls, box(T, H, D - 2 * T), 'part', { pos: [-W / 2 + T / 2, 0, 0] });
  solid(walls, box(T, H, D - 2 * T), 'part', { pos: [W / 2 - T / 2, 0, 0] });
  // window bands + door, slightly proud of the walls (no coplanar faces)
  for (const z of [-D / 2 - 0.03, D / 2 + 0.03])
    for (const x of [-8, 0, 8]) solid(walls, box(5.5, 0.9, 0.06), 'glass', { pos: [x, 2.4, z], shadow: false });
  solid(walls, box(3.2, 3.0, 0.08), 'partDark', { pos: [-4.4, 0, D / 2 + 0.04] });

  const roof = part('roof', bld, [0, 0.3 + H, 0]);
  const roofMeshes = [];
  const rs = (geo, col, o = {}) => { const m = solid(roof, geo, col, { ...o, transparent: true }); roofMeshes.push(m); return m; };
  rs(box(W + 0.4, 0.35, D + 0.4), 'part');
  rs(box(W + 0.4, 0.5, 0.2), 'part', { pos: [0, 0.35, -D / 2 - 0.1] });
  rs(box(W + 0.4, 0.5, 0.2), 'part', { pos: [0, 0.35, D / 2 + 0.1] });
  rs(box(0.2, 0.5, D), 'part', { pos: [-W / 2 - 0.1, 0.35, 0] });
  rs(box(0.2, 0.5, D), 'part', { pos: [W / 2 + 0.1, 0.35, 0] });
  for (const x of [-8, 0, 8]) rs(box(3.2, 0.3, 1.6), 'glass', { pos: [x, 0.35, -2.2] });
  rs(rbox(2.4, 1.1, 1.8, 0.08), 'partDark', { pos: [6, 0.35, 3.4] });
  rs(rbox(2.4, 1.1, 1.8, 0.08), 'partDark', { pos: [9.4, 0.35, 3.4] });

  // ---------- production line ----------
  const line = part('line', bld, [0, 0.3, 0]);
  const BELT_Y = 0.76; // items sit on the belt surface (item origin = bottom)

  const belt = part('belt', line);
  solid(belt, box(22, 0.62, 1.4), 'partDark', { pos: [0, 0.08, 0] });
  solid(belt, box(22.2, 0.06, 1.2), 'belt', { pos: [0, 0.7, 0], edges: false });
  solid(belt, scatter(box(0.12, 0.08, 1.5), [-9, -4.5, 0, 4.5, 9].map((x) => [x, 0, 0])), 'belt', { edges: false, occ: false });

  // input pallet with raw blocks (static)
  const input = part('input', line, [-12, 0, 0]);
  solid(input, box(1.5, 0.2, 1.5), 'partDark');
  solid(input, scatter(rbox(0.8, 0.5, 0.8, 0.04), [[-0.35, 0.2, -0.35], [0.4, 0.2, -0.35], [-0.35, 0.2, 0.4], [0.4, 0.2, 0.4], [0, 0.72, 0]]), 'part');

  // press
  const press = part('press', line, [-4, 0, 0]);
  solid(press, scatter(rbox(0.5, 3.6, 0.5, 0.05), [[0, 0, -1.15], [0, 0, 1.15]]), 'partDark');
  solid(press, rbox(1.3, 0.6, 3.0, 0.08), 'accent', { pos: [0, 3.6, 0] });
  const head = part('pressHead', press, [0, 2.2, 0]);
  solid(head, rbox(1.0, 0.45, 1.0, 0.05), 'partDark');
  solid(head, cyl(0.14, 1.2, 12), 'part', { pos: [0, 0.45, 0], edges: false });
  const HEAD_UP = 2.2, HEAD_DOWN = BELT_Y + 0.25; // flattened item top

  // oven: tunnel over the belt, front wall cut away so the inside is visible
  const oven = part('oven', line, [4, 0, 0]);
  solid(oven, rbox(5, 0.4, 2.7, 0.06), 'partDark', { pos: [0, 2.0, 0] });
  solid(oven, box(5, 2.0, 0.3), 'partDark', { pos: [0, 0, -1.2] });
  solid(oven, box(5, 0.55, 0.3), 'partDark', { pos: [0, 0, 1.2] }); // cutaway curb
  // heaters on the inner back wall: dark base + modest emissive (never glow light colours)
  const heaterMesh = solid(oven, scatter(box(4.4, 0.1, 0.08), [[0, 0.95, -1.0], [0, 1.35, -1.0], [0, 1.75, -1.0]]), 'heater', { edges: false, occ: false });
  solid(oven, cyl(0.25, 1.6, 14), 'part', { pos: [1.6, 2.4, -0.6] });

  // output rack with finished parts (static)
  const rack = part('rack', line, [12, 0, 0]);
  solid(rack, scatter(box(0.1, 2.4, 0.1), [[-0.5, 0, -1.4], [0.5, 0, -1.4], [-0.5, 0, 1.4], [0.5, 0, 1.4]]), 'partDark');
  solid(rack, scatter(box(1.2, 0.06, 3.0), [[0, 0.8, 0], [0, 1.6, 0], [0, 2.4, 0]]), 'partDark');
  solid(rack, scatter(rbox(0.8, 0.25, 0.8, 0.03), [[0, 0.86, -0.9], [0, 0.86, 0.1], [0, 1.66, -0.9], [0, 1.66, 0.1], [0, 1.66, 1.0]]), 'fired');

  // ---------- material flow ----------
  const PRESS_KEY = 1, OVEN_IN = 2, OVEN_OUT = 3;
  const path = makePath([
    { p: [-10.6, BELT_Y, 0], dwell: 0.6 },
    { p: [-4, BELT_Y, 0], dwell: 1.4 }, // press
    { p: [1.5, BELT_Y, 0] },            // oven in
    { p: [6.5, BELT_Y, 0] },            // oven out
    { p: [10.6, BELT_Y, 0], dwell: 0.8 },
  ], 2.2);
  const raw = color('part'), fired = color('fired'), tmp = new THREE.Color();
  const items = flow(line, path, {
    count: 6,
    geo: rbox(0.8, 0.5, 0.8, 0.04),
    stage(r) {
      const pressed = r.key > PRESS_KEY || (r.key === PRESS_KEY && (!r.dwell || r.f >= 0.5));
      const k = r.key < OVEN_IN ? 0 : r.key === OVEN_IN && !r.dwell ? r.f : 1; // colour by progress
      return {
        scale: pressed ? [1.1, 0.5, 1.1] : [1, 1, 1],
        color: tmp.copy(raw).lerp(fired, k),
      };
    },
  });
  // press cycle synced with the item spacing; hit at mid-dwell
  const pressMid = path.dwellStart[PRESS_KEY] + 0.7;
  const heatC = color('heat');

  K.finalize();

  return {
    root: K.root,
    parts: K.parts,
    solids: K.solids,
    occluders: K.occluders,
    /** Pure function of (state, time). No hidden animation state. */
    update(S, t) {
      const o = clamp01(S.open.building ?? 0);
      walls.scale.y = lerp(1, 0.06, o);
      roof.position.y = 0.3 + H + 3 * o;
      for (const m of roofMeshes) { m.userData.fade = 1 - o; m.material.depthWrite = o < 0.5; }
      roof.visible = o < 0.98;

      const a = S.act.press ?? 0;
      const ph = ((((t - pressMid) / items.spacing) % 1) + 1) % 1;
      const hit = Math.pow(Math.max(0, Math.cos(2 * Math.PI * ph)), 8);
      head.position.y = lerp(HEAD_UP, HEAD_DOWN + 0.02, hit * a);

      items.update(t, S.flow.items ?? 0);

      const h = S.heat.oven ?? 0;
      heaterMesh.material.emissive.copy(heatC).multiplyScalar((0.8 + 0.2 * Math.sin(t * 6)) * h);

      K.applyLook(S.highlight);
    },
  };
}
