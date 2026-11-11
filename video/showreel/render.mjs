// Renders the showreel teaser: frame-addressed Canvas in Chromium, FFmpeg encode.
//   node video/showreel/render.mjs                    full film with the score
//   node video/showreel/render.mjs --frames 0-112     inclusive range, review only
//   node video/showreel/render.mjs --stills 0,56,112  PNG stills in video/out/showreel-stills
//   node video/showreel/render.mjs --sheet 9          contact sheets, every ninth frame
//   node video/showreel/render.mjs --check-mark       compare the rig at rest with the official mark
//   node video/showreel/render.mjs --format vertical  the 1080 by 1920 cut; outputs are named showreel-vertical*
// --workers N sets the number of browsers that render in parallel (default 3).
// --silent encodes without the score. VIDEO_CHROMIUM names a Chromium binary
// when the pinned Playwright has none.
/* global window, document */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {REPO, FONTS, project as readProject, markSvg} from './data.mjs';

const SELF = fileURLToPath(import.meta.url), HERE = path.dirname(SELF);
const OUT = path.resolve(HERE, '../out');
const CACHE = path.resolve(HERE, '../.cache/showreel');
const args = process.argv.slice(2);
const value = key => (args.includes(key) ? args[args.indexOf(key) + 1] : null);
// Landscape keeps the names it always had. Vertical outputs carry the format in
// their names, so the two cuts never overwrite each other.
const FORMATS = {
  landscape: {width: 1920, height: 1080, name: 'showreel', stills: 'showreel-stills', tile: '480:270'},
  vertical: {width: 1080, height: 1920, name: 'showreel-vertical', stills: 'showreel-stills-vertical', tile: '270:480'},
};
// A missing value must not fall back to landscape without a word.
const FORMAT = args.includes('--format') ? value('--format') : 'landscape';
if (!FORMATS[FORMAT]) throw new Error(`--format takes ${Object.keys(FORMATS).join(' or ')}`);
const {width: WIDTH, height: HEIGHT, name: NAME} = FORMATS[FORMAT];
// Frame folders: landscape keeps its bare key, vertical has a prefix. A render
// removes stale folders of its own format only.
export const cachePrefix = format => (format === 'landscape' ? '' : `${format}-`);
export const ownsFolder = (format, folder) => (cachePrefix(format) ? folder.startsWith(cachePrefix(format)) : !Object.keys(FORMATS).some(other => folder.startsWith(`${other}-`)));
const PREFIX = cachePrefix(FORMAT), sameFormat = folder => ownsFolder(FORMAT, folder);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function bundle() {
  const result = await build({entryPoints: [path.join(HERE, 'main.ts')], bundle: true, format: 'iife', platform: 'browser', write: false});
  return result.outputFiles[0].contents;
}

function page() {
  const faces = FONTS.map(([family, file, weight]) => `@font-face{font-family:${family};src:url('/font/${path.basename(file)}');font-weight:${weight}}`).join('');
  return `<!doctype html><html><head><style>${faces}body{margin:0;background:rgb(0 0 0)}canvas{display:block}</style></head><body><canvas width="${WIDTH}" height="${HEIGHT}"></canvas><script src="/bundle.js"></script></body></html>`;
}

/** Everything a frame depends on: scene code, data, fonts, the mark, this file and the pinned browser. */
function inputKey(code, data) {
  const hash = crypto.createHash('sha256').update(code).update(JSON.stringify(data)).update(page()).update(markSvg());
  for (const [, file] of FONTS) hash.update(fs.readFileSync(path.join(REPO, file)));
  hash.update(fs.readFileSync(SELF)).update(fs.readFileSync(path.join(HERE, '../package-lock.json')));
  return hash.digest('hex').slice(0, 16);
}

async function serve(code) {
  const fonts = new Map(FONTS.map(([, file]) => [path.basename(file), path.join(REPO, file)]));
  const server = http.createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch { res.statusCode = 400; res.end('Bad request'); return; }
    if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page()); return; }
    if (name === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(code); return; }
    if (name === '/mark.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(markSvg()); return; }
    const font = fonts.get(name.replace('/font/', ''));
    if (name.startsWith('/font/') && font) { res.setHeader('Content-Type', 'font/woff2'); res.end(fs.readFileSync(font)); return; }
    res.statusCode = 404; res.end('Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function ffmpeg(list) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...list], {stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
}

/** One browser with the film loaded. Every worker gets the same bundle and data. */
async function open(code, data, errors) {
  const server = await serve(code);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({executablePath: process.env.VIDEO_CHROMIUM || undefined});
  const close = async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); };
  try {
    const context = await browser.newContext({viewport: {width: WIDTH, height: HEIGHT}, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block'});
    // The render page reads nothing outside this process.
    await context.route('**/*', route => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
    const tab = await context.newPage();
    tab.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
    await tab.goto(origin);
    await tab.waitForFunction(() => !!window.__REEL);
    await tab.evaluate(p => window.__REEL.load(p), data);
    const png = async frame => Buffer.from(await tab.evaluate(async f => {
      await window.__REEL.seek(f);
      return document.querySelector('canvas').toDataURL('image/png').split(',')[1];
    }, frame), 'base64');
    return {tab, png, close};
  } catch (error) { await close(); throw error; }
}

/** The WAV must be the one composed from the current clock. */
function currentScore(clock) {
  const wav = path.join(OUT, 'showreel.wav'), record = path.join(OUT, 'showreel.score.json');
  if (!fs.existsSync(wav) || !fs.existsSync(record)) throw new Error('No score. Run node video/showreel/make-score.mjs, or pass --silent.');
  const saved = JSON.parse(fs.readFileSync(record, 'utf8'));
  if (saved.clockHash !== sha256(JSON.stringify(clock)) || saved.wavSha256 !== sha256(fs.readFileSync(wav))) throw new Error('The score does not match the current clock. Run node video/showreel/make-score.mjs.');
  return wav;
}

async function main() {
  fs.mkdirSync(OUT, {recursive: true});
  const code = await bundle(), data = await readProject(FORMAT), {clock} = data, errors = [];
  const failOnPageErrors = () => { if (errors.length) throw new Error(`Render page reported ${errors.length} errors`); };
  const sound = !args.includes('--silent');
  const reel = await open(code, data, errors);
  const extra = [];
  try {
    if (args.includes('--check-mark')) {
      // Mean difference per channel, 0 to 255. Antialiasing alone gives about 0.1.
      const difference = await reel.tab.evaluate(() => window.__REEL.markDifference());
      failOnPageErrors();
      console.log('Mark difference', difference.toFixed(3));
      if (difference > .4) throw new Error('The rig at rest no longer matches design/brand/badger-mark.svg');
      return;
    }
    if (args.includes('--stills')) {
      const dir = path.join(OUT, FORMATS[FORMAT].stills); fs.mkdirSync(dir, {recursive: true});
      for (const frame of value('--stills').split(',').map(Number)) {
        fs.writeFileSync(path.join(dir, `${String(frame).padStart(4, '0')}.png`), await reel.png(frame));
      }
      failOnPageErrors();
      console.log('Stills in', dir);
      return;
    }
    const [start, end] = value('--frames') ? value('--frames').split('-').map(Number) : [0, clock.duration - 1];
    if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end < clock.duration && end >= start)) throw new Error('Invalid frame range');
    const step = args.includes('--sheet') ? Number(value('--sheet')) : 1;
    if (!(Number.isInteger(step) && step >= 1)) throw new Error('--sheet takes a whole number of frames');
    const partial = value('--frames') ? `-${start}-${end}` : '';
    const wav = step === 1 && sound ? currentScore(clock) : null;

    // One folder for each set of inputs; a frame is named by its number, so any
    // range or sheet reuses it. Folders for other inputs of the same format are
    // removed. The key covers the data, and the data holds the format.
    const key = `${PREFIX}${inputKey(code, data)}`, frames = path.join(CACHE, key);
    fs.mkdirSync(frames, {recursive: true});
    for (const other of fs.readdirSync(CACHE)) if (other !== key && sameFormat(other)) fs.rmSync(path.join(CACHE, other), {recursive: true, force: true});
    const file = frame => path.join(frames, `${String(frame).padStart(6, '0')}.png`);
    const list = [];
    for (let frame = start; frame <= end; frame += step) list.push(frame);
    const todo = list.filter(frame => !fs.existsSync(file(frame))), began = Date.now();

    // Each worker is its own browser, so frames render on separate processor cores.
    const count = Math.max(1, Math.min(Number(value('--workers') ?? 3), todo.length));
    const launched = await Promise.allSettled(Array.from({length: count - 1}, () => open(code, data, errors)));
    for (const result of launched) if (result.status === 'fulfilled') extra.push(result.value);
    const failed = launched.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    let next = 0, done = 0;
    try {
      await Promise.all([reel, ...extra].map(async worker => {
        while (next < todo.length) {
          const frame = todo[next++], image = await worker.png(frame);
          // Write under another name first: a stopped run leaves no half-written frame.
          fs.writeFileSync(`${file(frame)}.tmp`, image); fs.renameSync(`${file(frame)}.tmp`, file(frame));
          if (++done % 150 === 0) console.log('Frames', done, 'of', todo.length, `${Math.round((Date.now() - began) / 1000)}s`);
        }
      }));
      failOnPageErrors();
    } catch (error) {
      // Frames drawn by a failing page are not trusted.
      fs.rmSync(frames, {recursive: true, force: true});
      throw error;
    }

    if (step > 1) {
      const sheet = new RegExp(`^${NAME}-sheet-\\d+\\.jpg$`);
      for (const old of fs.readdirSync(OUT)) if (sheet.test(old)) fs.unlinkSync(path.join(OUT, old));
      const index = path.join(frames, 'sheet.ffconcat');
      fs.writeFileSync(index, `ffconcat version 1.0\n${list.map(frame => `file '${file(frame)}'\nduration ${1 / 30}`).join('\n')}\n`);
      // Each tile prints its source frame number.
      const label = `drawtext=text='%{eif\\:n*${step}+${start}\\:d}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6`;
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', index, '-vf', `scale=${FORMATS[FORMAT].tile},${label},tile=5x6`, '-fps_mode', 'passthrough', '-q:v', '3', path.join(OUT, `${NAME}-sheet-%02d.jpg`)]);
      console.log('Sheets in', OUT);
      return;
    }
    const final = path.join(OUT, `${NAME}${partial}.mp4`);
    const encode = ['-framerate', '30', '-start_number', String(start), '-i', path.join(frames, '%06d.png')];
    if (wav) encode.push('-ss', String(start / 30), '-i', wav);
    // Convert with the BT.709 matrix the file is tagged with.
    encode.push('-frames:v', String(list.length), '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', partial ? 'veryfast' : 'slow', '-crf', '18', '-r', '30');
    encode.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
    if (wav) encode.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-t', String(list.length / 30));
    encode.push('-movflags', '+faststart', final);
    await ffmpeg(encode);
    console.log('Rendered', final, wav ? 'with score' : 'silent');
  } finally { await Promise.all([reel, ...extra].map(worker => worker.close())); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) await main();
