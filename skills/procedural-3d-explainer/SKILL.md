---
name: "procedural-3d-explainer"
description: "Build a procedural Three.js (no GLB) 3D explainer from the explainer-kit repo: interactive page with chapters and annotations, plus MP4 video render. Use for robot, machine, factory or process stories."
---

# Procedural 3D explainer (Three.js, one source for web + video)

Goal: ONE procedural scene (no GLB/CAD) that serves an interactive page, future videos (voice agent / Instagram) and live dashboards. Proven on a robot-arm anatomy tour and a 3-building carbon-disc factory.

## Work in the explainer-kit repo (do not rewrite the runtime)
Code lives in GitHub `jga-22/explainer-kit` (clone it if it is not already in the workspace). Layout: `runtime/` (stable engine), `projects/<name>/` (`world.js` + `story.json` [+ `style.json` overrides deep-merged over `runtime/style.json`]), `tools/`.
1. `npm install` (three 0.170.0, esbuild, playwright), `npx playwright install chromium` once; `ffmpeg` on PATH for video.
2. New explainer: copy `projects/workshop-demo` to `projects/<name>`, rewrite `world.js` (the scene) and `story.json` (the content).
3. Leave `runtime/` unchanged unless the improvement is reusable; then rebuild and re-screenshot every project.
4. `node tools/build.mjs projects/<name>` -> `dist/<name>/index.html` (+ `fragment.html` for claude.ai).
5. `node tools/shots.mjs dist/<name>/index.html [--cpu]` and review `shots/<name>/contact-sheet.png`.
6. Video: `node tools/render-video.mjs dist/<name>/index.html --format vertical|landscape|square [--cpu] [--from s --to s]` -> `video/<name>-<format>.mp4`. Frame vertical videos for a 9:16 aspect: tighter `dist`, subjects centred, labels with small `off`.
Sandbox without npm access: symlink esbuild/playwright into node_modules and point `node_modules/three` at a git clone of three.js tag r170.

## UX rules (non-negotiable, user-validated)
- Chapter navigation is the main UX: chips on top, prev/next, dots, free orbit. Auto-play is secondary: ONE play/pause icon.
- One idea per beat: one camera move, one or two annotations, one short sentence. Never several texts at once.
- Text card has an `Aa` toggle (top-right of the card): Full / Short only. No third "zero text" mode.
- White background, no grid lines, white + blue minimalist palette. Perspective camera only (no iso toggle).
- Opening beat = global view; then zoom into each sub-system (site -> building -> machine). Physical flow shown with moving items, not decoration.
- Effects must carry an idea (heat, flow, rotation axes), never decoration/wave intros.
- Annotations anchored to part-local points, HTML label + SVG leader, dimmed to 25% when occluded (raycast), clamped away from header and control bar.
- All styling centralised in `style.json` (palette, font sizes, text levels, scene constants). Story content in `<name>-story.json`.

## Architecture
```
runtime/theme.js     style.json -> CSS variables; hex()/num()/color()/glsl() colour helpers
runtime/story.js     loadStory, evalBeat, resolveState, blend, schedule, timedState (pure functions)
runtime/kit.js     createKit(): part(), solid(), finalize(), applyLook(highlight), occluders(); rbox/box/cyl/scatter; makePath, flow, trees
projects/x/world.js     buildWorld() -> {root, parts, solids, occluders, update(S,t)}   <- scene-specific
runtime/main.js     renderer, camera, OrbitControls, notes, UI, window.__tour
runtime/template.html page shell + CSS (uses CSS vars)
tools/build.mjs   esbuild bundle (iife, minify) -> dist/<name>/index.html + fragment.html; size check; --all
tools/shots.mjs   Playwright: screenshot each beat via __tour.seek + mid-transition frames + contact sheet
tools/render-video.mjs  seek frame by frame in manual mode (setManual: no rAF loop) -> ffmpeg H.264 MP4
```
Build: a resolver plugin maps `tour-data` -> story.json, `tour-world` -> world.js and `style-data` -> merged style; `</script` in the bundle is escaped.

### Story model
- Story = chapters of beats. A beat is a STATE: camera `{az, el, dist, target}`, which parts are `open`, per-beat maps (`flow`, `act`, `heat`, `highlight`), `notes`, `text` + `short`. Camera and open-state carry over between beats; other maps are per beat (repeat `flow`/`act` on every beat that needs them). Defaults: duration 5 s, transition 2 s.
- Camera `target` is a point or `{part, off}` resolved to a world position every frame. `az` is measured from +z toward +x, `el` from the ground plane.
- Note: `{part, at:[local xyz], tag, text, sub, off:[dx,dy] px}`; negative dx puts the label left of the anchor. Keep `at` slightly outside the surface so the part itself does not occlude it.
- `evalBeat(beat)` -> plain-number state S. `blend(A,B,e)` lerps every map and the camera (distance in log space, azimuth the short way); old notes fade out in e 0-0.25, new ones fade in from e 0.6 (a note in both stays), caption swaps at e=0.35.
- Interactive mode: blend from a SNAPSHOT of the current state (camera read from the view after a user orbit) to the target beat; the user can interrupt anytime. Timed mode: `timedState(beats,t)` uses the same pure functions; `window.__tour = {duration, beats, starts, transitions, goTo(i), seek(t), setManual(v), play(), pause(), frame(), ready}` lets a video renderer drive it frame by frame.
- World `update(S, t)` is a pure function of (state, time): never keep hidden mutable animation state. Machine animation scaled by `act[name]`, glow by `heat[name]`, building roofs fade/lift (`userData.fade`) and walls scale to a curb by `open[id]`. Call `K.applyLook(S.highlight)` at the end.

### Scene building
- A scene is a tree of named part Groups (`part(name, parent, pos)`), each holding meshes with edge outlines (`EdgesGeometry`). `solid(group, geo, colourKey, {pos, rot, scale, edges, shadow, occ, flat, transparent})` registers meshes for highlight and occlusion. Use `occ:false` for scenery and ground.
- Geometry helpers have their origin at the bottom centre (`rbox`, `box`, `cyl`), so `pos` y = the surface they stand on.
- Highlight = ghosting: non-highlighted colours lerp 70% toward the ghost colour and their edges fade; highlighting a part also highlights its children.
- Geometry: RoundedBoxGeometry for chamfered boxes, Shape+ExtrudeGeometry for annular/notched discs, `scatter`/`mergeGeometries` for repeated small parts (legs, posts, trees, stacked stock), open-ended cylinder with thetaStart/Length for furnace cutaways, Tube on a curve for pipes.
- Material flow: `makePath(keys, speed)` constant-speed polyline with dwell times per key (`dwellStart[i]` for syncing machines); `flow()` = InstancedMesh items on that path with a per-frame `stage(r)` (scale, colour, spin, hidden). Colour items by progress so the transformation is visible (white -> dark).
- Item spacing: the time between items (`period / count`) must exceed the longest dwell plus a gap, or items overlap at a station. Sync a machine stroke to `items.spacing` with its peak at mid-dwell (see the press in world.js).
- Keep item scale/height consistent with belt height; item origin at its bottom.
- Show interiors with cutaways (low front curb) rather than transparency.
- Avoid coplanar faces (z-fighting stripes): make overlapping boxes differ by >= 0.02 or shorten one.
- Don't emissive-glow light colours (turns pink/mauve): glow only small dark elements (heater bars) with a modest emissive.

### Site / realism (when the scene is a plant)
Buildings: slab, 4 m walls, window bands, doors, roof with parapet, skylights, HVAC units, stacks. Surroundings: lawn pad, apron, road with dashes, fence, low-poly trees (merged, flatShading), utilities (tanks, pipe, cooling tower, chimney), trucks at dock/store. Open a building = roof fades + lifts, walls drop to a curb so the inside flow is visible. Keep an elevated guide line + arrows for the site flow, NOT moving items (they are redundant with the detailed shops).

## Camera, lighting, gotchas
- Camera `far` must exceed maxDistance * aspect-fit factor (fit up to 1.8 on phones). A too-short far plane makes buildings vanish when zoomed out. Used: near 0.5, far 900, maxDistance 260, shadow camera far 160 (all in style.json `scene`).
- Lighting for a white scene: Hemisphere (~2.3) + sun with 4096 shadow map + a weak cool fill directional from the opposite side so shaded faces stay distinguishable. Neutral tone mapping. Floor = ShadowMaterial (opacity ~0.08). Faces overexposed to white vanish against a white background.
- Frame every beat so the subject is visible below the header/caption (view offset lifts the scene by `viewLift` of the height).
- Overview framing: pick dist so the whole site fits at the narrowest expected aspect; re-check on phone width.
- Low elevation (el ~0.2) to look inside tunnels/ovens; high elevation hides interiors behind roofs.

## Publishing as an Artifact (claude.ai)
- Publish `dist/<name>/fragment.html` (title + style + body) as a private artifact; the update keeps the same URL when the same file path or `url` is passed.
- SIZE: the publish validator refuses pages of about 640 KiB or more. build.mjs prints the size (workshop demo ~540 KiB). three.js dominates: keep minify, no RoomEnvironment/PMREM (Hemisphere light instead), no unused addons.
- Browser storage may be unavailable: it is wrapped in try/catch (runtime/main.js `store`).

## QA workflow
- `tools/shots.mjs` seeks each beat deterministically (no frame counting), saves `beat-NN.png`, mid-transition `trans-NN.png` and `contact-sheet.png`, and fails on page errors. Without a GPU use `--cpu` (SwiftShader flags: `--use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader --ignore-gpu-blocklist`).
- Review: framing, label vs caption overlap, occluded labels, z-fighting, items too small, oversized flows, odd colours.
- Also test free orbit (mouse drag), prev/next, play and the `Aa` toggle once, and the phone viewport, before publishing.

## Process
1. Agree the story (chapters/beats, one sentence each) and the sub-systems to zoom into. 2. Copy projects/workshop-demo, build world.js part by part with a flow and act/heat maps. 3. Write the story JSON. 4. Build, screenshot all beats, fix. 5. Check size, publish, give a one-line summary.
