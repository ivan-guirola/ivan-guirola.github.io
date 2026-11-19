import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'public', 'og');
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const fonts = {};
for (const [key, pkg, file] of [
  ['display', 'bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2'],
  ['displayExt', 'bricolage-grotesque', 'bricolage-grotesque-latin-ext-wght-normal.woff2'],
  ['sans', 'geist', 'geist-latin-wght-normal.woff2'],
  ['mono', 'geist-mono', 'geist-mono-latin-wght-normal.woff2'],
]) {
  const data = await readFile(join(ROOT, 'node_modules', '@fontsource-variable', pkg, 'files', file));
  fonts[key] = `data:font/woff2;base64,${data.toString('base64')}`;
}

async function pages(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await pages(path)));
    else if (entry.name === 'index.html') found.push(path);
  }
  return found;
}

const meta = (html, attr, name) =>
  (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1] ?? '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const imageName = (path) => (path.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home') + '.png';

function card({ title, description, path, home }) {
  const size = home ? 96 : title.length > 32 ? 68 : 80;
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: Display; src: url(${fonts.display}); font-weight: 200 800; }
@font-face { font-family: Display; src: url(${fonts.displayExt}); font-weight: 200 800; unicode-range: U+0100-024F; }
@font-face { font-family: Sans; src: url(${fonts.sans}); font-weight: 100 900; }
@font-face { font-family: Mono; src: url(${fonts.mono}); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body {
  position: relative; overflow: hidden; padding: 72px 80px 64px;
  display: flex; flex-direction: column;
  background: #07090f; color: #eef0f7; font-family: Sans, sans-serif;
}
body::before {
  content: ''; position: absolute; inset: 0;
  background-image: linear-gradient(#212a3d 1px, transparent 1px), linear-gradient(90deg, #212a3d 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse 90% 80% at 85% 10%, #000 10%, transparent 75%);
  opacity: .55;
}
body::after {
  content: ''; position: absolute; width: 620px; height: 620px; right: -180px; top: -260px;
  background: radial-gradient(circle, rgb(148 131 255 / .28), transparent 65%);
}
header, main, footer { position: relative; z-index: 1; }
header { display: flex; align-items: center; gap: 18px; font-size: 26px; font-weight: 500; }
header svg { width: 48px; height: 48px; }
main { margin-top: auto; max-width: 980px; }
h1 { font-family: Display, sans-serif; font-weight: 650; letter-spacing: -.02em; line-height: 1.04; font-size: ${size}px; }
p {
  margin-top: 26px; font-size: 30px; line-height: 1.4; color: #98a1b8;
  display: -webkit-box; -webkit-line-clamp: ${home ? 3 : 2}; -webkit-box-orient: vertical; overflow: hidden;
}
footer { margin-top: 48px; font-family: Mono, monospace; font-size: 22px; color: #9483ff; }
</style></head><body>
<header>
  <svg viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#eef0f7"/><rect x="6.5" y="9" width="3.4" height="14" fill="#07090f"/><path d="M24.3 11.5A6.6 6.6 0 1 0 26 16h-5.4" fill="none" stroke="#07090f" stroke-width="3.2"/></svg>
  ${home ? 'Identity and access management' : 'Iván Guirola'}
</header>
<main>
  <h1>${escape(title)}</h1>
  <p>${escape(description)}</p>
</main>
<footer>ivan-guirola.github.io${escape(path.replace(/\/$/, ''))}</footer>
</body></html>`;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const file of await pages(DIST)) {
  const html = await readFile(file, 'utf8');
  const parts = relative(DIST, file).split(sep).slice(0, -1);
  const path = parts.length ? `/${parts.join('/')}/` : '/';
  const home = path === '/';
  const title = home ? 'Iván Guirola' : meta(html, 'property', 'og:title').replace(/ \| Iván Guirola$/, '');
  await page.setContent(card({ title, description: meta(html, 'name', 'description'), path, home }), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(OUT, imageName(path)) });
  console.log(imageName(path));
}
await browser.close();
