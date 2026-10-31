// Render a project to MP4 by seeking the timeline frame by frame (deterministic).
//   node tools/render-video.mjs dist/<name>/index.html [--format vertical|landscape|square]
//        [--fps 30] [--from 0] [--to <s>] [--out video/<name>-<format>.mp4] [--cpu] [--crf 20] [--preset veryfast]
// Needs ffmpeg on PATH (or FFMPEG=path). Captions + annotations are kept, controls are hidden (?ui=0).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VALUED = new Set(['--format', '--size', '--scale', '--fps', '--from', '--to', '--out', '--crf', '--preset']);
const file = path.resolve(args.find((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1])) || 'dist/workshop-demo/index.html');
const FORMATS = { vertical: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };
const format = opt('--format', 'vertical');
const [W, H] = FORMATS[format] || opt('--size', '1080x1920').split('x').map(Number);
const scale = +opt('--scale', 2); // CSS px -> video px (text stays readable)
const fps = +opt('--fps', 30);
const cpu = args.includes('--cpu');
const name = path.basename(path.dirname(file));
const out = path.resolve(opt('--out', `video/${name}-${format}.mp4`));
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: cpu ? ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
});
const page = await browser.newPage({ viewport: { width: Math.round(W / scale), height: Math.round(H / scale) }, deviceScaleFactor: scale });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(file).href + '?ui=0');
await page.waitForFunction(() => window.__tour && window.__tour.ready, null, { timeout: 120000 });
const duration = await page.evaluate(() => __tour.duration);
const from = +opt('--from', 0), to = Math.min(+opt('--to', duration), duration);
const n = Math.ceil((to - from) * fps);
await page.evaluate(() => __tour.setManual(true));

const ffmpeg = spawn(process.env.FFMPEG || 'ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-preset', opt('--preset', 'veryfast'), '-crf', opt('--crf', '20'),
  '-pix_fmt', 'yuv420p', '-vf', `scale=${W}:${H}`, '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => ffmpeg.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

const t0 = Date.now();
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => __tour.seek(t), from + i / fps); // renders synchronously in manual mode
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ffmpeg.stdin.write(buf)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (i % fps === 0) process.stdout.write(`\r${(i / fps).toFixed(0)}/${(n / fps).toFixed(0)} s  (${((Date.now() - t0) / 1000).toFixed(0)} s elapsed)`);
}
ffmpeg.stdin.end();
await done;
await browser.close();
console.log(`\n${path.relative(process.cwd(), out)}  ${W}x${H} ${fps} fps ${(to - from).toFixed(1)} s`);
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
