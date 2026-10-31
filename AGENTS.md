# Instructions for AI agents (Claude, Codex, Antigravity, Gemini, Copilot)

Read `skills/procedural-3d-explainer/SKILL.md` before any work on a project here. In short:
- New explainer = new folder `projects/<name>/` with `world.js` + `story.json`. Copy `projects/workshop-demo` to start.
- Do not modify `runtime/` for one project. Change it only for a reusable improvement, and rebuild + re-screenshot ALL projects.
- Always finish with: `node tools/build.mjs projects/<name>` then `node tools/shots.mjs dist/<name>/index.html` (add `--cpu` without a GPU) and look at the contact sheet. Zero page errors.
- Never commit `node_modules/`, `dist/`, `shots/`, `video/`.
