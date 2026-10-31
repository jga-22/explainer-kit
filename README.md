# explainer-kit

Procedural Three.js explainers: **one scene source** for interactive pages, videos and (later) live dashboards. No GLB/CAD, no frameworks; each output is a single self-contained HTML file.

```
runtime/            stable engine: story.js (pure timeline), main.js (camera, labels, UI, __tour API),
                    kit.js (scene helpers), theme.js, template.html, style.json (default look)
projects/<name>/    world.js (the scene) + story.json (chapters/beats) [+ style.json overrides]
tools/              build.mjs, shots.mjs (QA screenshots), render-video.mjs (MP4)
skills/             procedural-3d-explainer/SKILL.md (rules for AI agents; copy to your agent's skills dir)
```

## Quick start
```
npm install
npx playwright install chromium             # screenshots + video
npm run build                               # every project -> dist/<name>/index.html
npm run shots -- dist/workshop-demo/index.html
npm run video -- dist/workshop-demo/index.html --format vertical   # or landscape | square
```
Video needs `ffmpeg` on PATH (Windows: `winget install Gyan.FFmpeg`). Add `--cpu` on machines without a GPU (slow: ~2 s/frame at 1080x1920).

## New explainer
1. `cp -r projects/workshop-demo projects/<name>`
2. Rewrite `world.js` (parts, flows, `update(S, t)`) and `story.json` (chapters -> beats).
3. `node tools/build.mjs projects/<name>`, then shots, review `shots/<name>/contact-sheet.png`.

## Outputs
| Output | Command | Notes |
|---|---|---|
| Interactive page | `npm run build` | `dist/<name>/index.html`; `fragment.html` for claude.ai artifacts (< 640 KiB) |
| QA screenshots | `npm run shots -- <page>` | every beat + mid-transitions + contact sheet; fails on page errors |
| Video | `npm run video -- <page>` | deterministic frame-by-frame via `__tour.seek(t)`; controls hidden, captions kept |

URL params: `?beat=N`, `?t=12.5` (timed), `?ui=0` (no controls).
API: `window.__tour = { duration, beats, starts, transitions, goTo, seek, setManual, play, pause, frame, ready }`.

CI (GitHub Actions) builds every project and screenshots it on each push; results are attached to the run as artifacts.
