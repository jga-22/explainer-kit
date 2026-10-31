// Build one project (or all) into a single self-contained HTML page.
//   node tools/build.mjs projects/<name>     node tools/build.mjs --all
// -> dist/<name>/index.html (full page) + dist/<name>/fragment.html (claude.ai artifact)
// A project = world.js + story.json [+ style.json, deep-merged over runtime/style.json]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 655000; // claude.ai artifact publish limit (~640 KiB)
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const merge = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a?.[k] || {}, v) : v;
  return o;
};
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function buildProject(dir) {
  dir = path.resolve(dir);
  const name = path.basename(dir);
  const storyPath = path.join(dir, 'story.json');
  const worldPath = path.join(dir, 'world.js');
  for (const f of [storyPath, worldPath]) if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(root, f)}`);
  const projStyle = path.join(dir, 'style.json');
  const style = merge(readJson(path.join(root, 'runtime/style.json')), fs.existsSync(projStyle) ? readJson(projStyle) : {});
  const story = readJson(storyPath);

  const plugin = {
    name: 'project',
    setup(b) {
      b.onResolve({ filter: /^tour-data$/ }, () => ({ path: storyPath }));
      b.onResolve({ filter: /^tour-world$/ }, () => ({ path: worldPath }));
      b.onResolve({ filter: /^style-data$/ }, () => ({ path: 'style', namespace: 'style' }));
      b.onLoad({ filter: /.*/, namespace: 'style' }, () => ({ contents: JSON.stringify(style), loader: 'json' }));
    },
  };
  const res = await build({
    entryPoints: [path.join(root, 'runtime/main.js')],
    bundle: true, format: 'iife', minify: true, write: false,
    target: 'es2020', legalComments: 'none', logLevel: 'warning',
    nodePaths: [path.join(root, 'node_modules')],
    plugins: [plugin],
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const title = esc(story.title || name);
  const tpl = fs.readFileSync(path.join(root, 'runtime/template.html'), 'utf8');
  const html = tpl.replace('{{TITLE}}', () => title).replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
  const css = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();
  const fragment = `<title>${title}</title>\n${css}\n${body}\n`;

  const out = path.join(root, 'dist', name);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.writeFileSync(path.join(out, 'fragment.html'), fragment);
  const size = Buffer.byteLength(fragment);
  console.log(`dist/${name}/index.html  ${(size / 1024).toFixed(0)} KiB ${size < LIMIT ? '' : '(TOO LARGE for claude.ai artifact)'}`);
  return path.join(out, 'index.html');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const dirs = !arg || arg === '--all'
    ? fs.readdirSync(path.join(root, 'projects')).map((d) => path.join(root, 'projects', d)).filter((d) => fs.existsSync(path.join(d, 'story.json')))
    : [arg];
  for (const d of dirs) await buildProject(d);
  // index page listing all projects (GitHub Pages landing)
  const names = fs.readdirSync(path.join(root, 'dist')).filter((d) => fs.existsSync(path.join(root, 'dist', d, 'index.html')));
  fs.writeFileSync(path.join(root, 'dist/index.html'), `<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Explainers</title><style>body{font:16px system-ui;margin:40px auto;max-width:640px;padding:0 16px;color:#0f1b2d}a{color:#1f6feb}</style><h1>Explainers</h1><ul>${names.map((n) => `<li><a href="${n}/">${n}</a></li>`).join('')}</ul>`);
}
