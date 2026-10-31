// Screenshot every beat (deterministic via __tour.seek) + a contact sheet.
// node tools/shots.mjs dist/<name>/index.html [--cpu] [--size 1100x640] [--out shots/<name>]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const file = path.resolve(args.find((a) => !a.startsWith('--') && !/^\d+x\d+$/.test(a) && a !== opt('--out')) || 'dist/workshop-demo/index.html');
const cpu = args.includes('--cpu'); // no GPU (CI / cloud): SwiftShader
const [w, h] = opt('--size', '1100x640').split('x').map(Number);
const out = path.resolve(opt('--out', `shots/${path.basename(path.dirname(file))}`));
const settle = cpu ? 1500 : 300;
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: cpu ? ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(pathToFileURL(file).href);
await page.waitForFunction(() => window.__tour && window.__tour.ready, null, { timeout: 120000 });
const info = await page.evaluate(() => ({ n: __tour.beats, starts: __tour.starts, trans: __tour.transitions, duration: __tour.duration }));
console.log(`${info.n} beats, ${info.duration.toFixed(1)} s`);

const shots = [];
for (let i = 0; i < info.n; i++) {
  const t = info.starts[i] + info.trans[i] + 0.5; // just after the transition
  await page.evaluate((t) => __tour.seek(t), t);
  await page.evaluate(() => __tour.frame());
  await page.waitForTimeout(settle);
  const f = path.join(out, `beat-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: f });
  shots.push(f);
  console.log(f);
}
// mid-transition frames catch blending bugs
for (let i = 1; i < info.n; i++) {
  const t = info.starts[i] + info.trans[i] * 0.5;
  await page.evaluate((t) => __tour.seek(t), t);
  await page.evaluate(() => __tour.frame());
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(out, `trans-${String(i).padStart(2, '0')}.png`) });
}

// contact sheet rendered by the browser itself (no Python needed)
const cols = 3;
const tw = 520, th = Math.round((tw * h) / w);
const imgs = shots.map((f, i) => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><figcaption>beat ${i}</figcaption></figure>`).join('');
const sheet = await browser.newPage({ viewport: { width: cols * (tw + 16) + 16, height: 400 } });
await sheet.setContent(`<style>body{margin:8px;font:12px system-ui;background:#eef2f7;display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:8px}figure{margin:0;background:#fff;padding:4px}img{width:${tw}px;height:${th}px;display:block}</style>${imgs}`);
await sheet.screenshot({ path: path.join(out, 'contact-sheet.png'), fullPage: true });
console.log(path.join(out, 'contact-sheet.png'));
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
await browser.close();
