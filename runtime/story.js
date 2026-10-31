// Story model: pure functions only (no DOM, no three.js) so the same code
// drives the interactive page and a frame-by-frame video renderer.
export const DEFAULTS = { duration: 5, transition: 2 };
const MAPS = ['open', 'flow', 'act', 'heat', 'highlight'];

const lerp = (a, b, e) => a + (b - a) * e;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const angLerp = (a, b, e) => {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * e;
};
const noteKey = (n) => n.id ?? `${n.part}|${n.tag}`;

/** JSON {title, chapters:[{title, beats:[...]}]} -> flat beats.
 *  camera and open carry over between beats; other maps are per beat. */
export function loadStory(json) {
  const beats = [];
  let cam = { az: 0.6, el: 0.5, dist: 60, target: [0, 0, 0] };
  let open = {};
  json.chapters.forEach((ch, ci) => {
    ch.beats.forEach((b) => {
      cam = { ...cam, ...(b.camera || {}) };
      if (b.open) open = { ...open, ...b.open };
      beats.push({
        index: beats.length,
        chapter: ci,
        chapterTitle: ch.title,
        duration: b.duration ?? json.duration ?? DEFAULTS.duration,
        transition: beats.length === 0 ? 0 : (b.transition ?? json.transition ?? DEFAULTS.transition),
        camera: cam,
        open: { ...open },
        flow: b.flow || {}, act: b.act || {}, heat: b.heat || {}, highlight: b.highlight || {},
        notes: b.notes || [],
        text: b.text || '',
        short: b.short ?? b.text ?? '',
      });
    });
  });
  return { title: json.title || '', chapters: json.chapters.map((c) => c.title), beats };
}

/** Beat -> plain state S. camera.target stays a spec until resolveState(). */
export function evalBeat(b) {
  const S = {
    cam: { az: b.camera.az, el: b.camera.el, dist: b.camera.dist, target: b.camera.target },
    notes: b.notes.map((n) => ({ ...n, alpha: 1 })),
    text: b.text, short: b.short, textAlpha: 1, beat: b.index,
  };
  for (const m of MAPS) S[m] = { ...b[m] };
  return S;
}

/** Replace the camera target spec (point or {part, off}) by a world point. */
export function resolveState(S, resolve) {
  return { ...S, cam: { ...S.cam, target: resolve(S.cam.target) } };
}

const mapLerp = (A, B, e) => {
  const o = {};
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) o[k] = lerp(A[k] ?? 0, B[k] ?? 0, e);
  return o;
};

/** Blend two resolved states. e is already eased (0..1). */
export function blend(A, B, e) {
  const S = {
    cam: {
      az: angLerp(A.cam.az, B.cam.az, e),
      el: lerp(A.cam.el, B.cam.el, e),
      dist: Math.exp(lerp(Math.log(A.cam.dist), Math.log(B.cam.dist), e)), // log space
      target: A.cam.target.map((v, i) => lerp(v, B.cam.target[i], e)),
    },
  };
  for (const m of MAPS) S[m] = mapLerp(A[m], B[m], e);
  // Notes: old fade out in e 0-0.25, new fade in from 0.6. A note present in both stays.
  const inB = new Set(B.notes.map(noteKey));
  const inA = new Set(A.notes.map(noteKey));
  const fo = 1 - ease(e / 0.25), fi = ease((e - 0.6) / 0.4);
  S.notes = [
    ...A.notes.filter((n) => !inB.has(noteKey(n))).map((n) => ({ ...n, alpha: (n.alpha ?? 1) * fo })),
    ...B.notes.map((n) => ({ ...n, alpha: inA.has(noteKey(n)) ? 1 : fi })),
  ].filter((n) => n.alpha > 0.002);
  // Caption swaps at e = 0.35 (fade out before, fade in after).
  const second = e >= 0.35;
  S.text = second ? B.text : A.text;
  S.short = second ? B.short : A.short;
  S.textAlpha = second ? ease((e - 0.35) / 0.2) : 1 - ease((e - 0.15) / 0.2);
  S.beat = e < 0.5 ? A.beat : B.beat;
  return S;
}

/** Timeline: beat i = [transition_i then duration_i]. */
export function schedule(beats) {
  let t = 0;
  const starts = beats.map((b) => { const s = t; t += b.transition + b.duration; return s; });
  return { starts, duration: t };
}

/** Deterministic state at time t (seconds) for video rendering. */
export function timedState(beats, t, resolve, sched = schedule(beats)) {
  const { starts } = sched;
  let i = 0;
  while (i + 1 < beats.length && t >= starts[i + 1]) i++;
  const local = t - starts[i];
  const B = resolveState(evalBeat(beats[i]), resolve);
  if (i > 0 && local < beats[i].transition) {
    const A = resolveState(evalBeat(beats[i - 1]), resolve);
    return { S: blend(A, B, ease(local / beats[i].transition)), index: i };
  }
  return { S: B, index: i };
}
