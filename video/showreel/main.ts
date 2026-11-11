// Browser entry point. Exposes a frame seek that resolves only after fonts are
// ready, so type is never measured with a fallback face.
import {W, H, type Project, hash, rgb, BLACK, setFormat} from './kit.ts';
import {badger, REST} from './badger.ts';
import {createStage, type Stage} from './stage.ts';

declare global { interface Window { __REEL: {load: (project: Project) => Promise<void>; seek: (frame: number) => Promise<number>; markDifference: () => Promise<number>}; } }

// The page that render.mjs writes sizes this canvas for the format.
const canvas = document.querySelector('canvas')!;
const out = canvas.getContext('2d', {alpha: false})!;
const layer = (w = W, h = H) => { const el = document.createElement('canvas'); el.width = w; el.height = h; return el; };
type Level = {el: HTMLCanvasElement; context: CanvasRenderingContext2D; full: boolean};
// The buffers take the frame size, so they are made in load, after setFormat.
let sample: HTMLCanvasElement, sampleContext: CanvasRenderingContext2D, levels: Level[], glow: HTMLCanvasElement, glowContext: CanvasRenderingContext2D;
const grain = layer(512, 512);
let project: Project, stage: Stage;

function buffers() {
  // One sample buffer and five shutter buffers for the whole render.
  sample = layer(); sampleContext = sample.getContext('2d', {alpha: false})!;
  // Level k holds the mean of 2^k samples. Two equal levels merge at 50%, so
  // every sample has the same weight; a running average on 8-bit pixels would
  // round the late samples away.
  levels = Array.from({length: 5}, () => { const el = layer(); return {el, context: el.getContext('2d', {alpha: false})!, full: false}; });
  glow = layer(W / 4, H / 4); glowContext = glow.getContext('2d', {alpha: false})!;
}

function makeGrain(seed: number) {
  const g = grain.getContext('2d')!, image = g.createImageData(512, 512);
  for (let i = 0; i < 512 * 512; i++) {
    const v = Math.round(128 + (hash(seed + i) - .5) * 150);
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255;
  }
  g.putImageData(image, 0, 0);
}

async function load(next: Project) {
  project = next;
  // The format sets the frame size before any buffer, page or scene is made.
  setFormat(project.format);
  if (canvas.width !== W || canvas.height !== H) throw new Error(`The page canvas is ${canvas.width} by ${canvas.height}, not ${W} by ${H}`);
  buffers();
  const faces = ['800 40px Bricolage', '700 40px Bricolage', '400 40px Source', '600 40px Source', '700 40px Source', '400 40px Mono', '500 40px Mono',
    ...project.styles.map(style => `${style.weight} 40px ${style.font}`)];
  const loaded = await Promise.all(faces.map(face => document.fonts.load(face)));
  loaded.forEach((list, i) => { if (!list.length) throw new Error(`Font did not load: ${faces[i]}`); });
  await document.fonts.ready;
  makeGrain(project.clock.seed);
  stage = createStage(project);
}

/** 180-degree shutter: 1, 8 or 16 samples cover the first half of the frame interval. */
function seek(frame: number) {
  const samples = stage.samples(frame);
  for (const level of levels) level.full = false;
  for (let i = 0; i < samples; i++) {
    stage.draw(sampleContext, frame + .5 * i / samples);
    let carry: HTMLCanvasElement = sample;
    for (const level of levels) {
      if (!level.full) { level.context.globalAlpha = 1; level.context.drawImage(carry, 0, 0); level.full = true; break; }
      level.context.globalAlpha = .5; level.context.drawImage(carry, 0, 0); level.full = false; carry = level.el;
    }
  }
  const shutter = levels[Math.log2(samples)].el;
  out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1; out.filter = 'none';
  out.drawImage(shutter, 0, 0);
  // Halation: a soft quarter-size copy screened back over the picture.
  glowContext.filter = 'blur(7px)'; glowContext.drawImage(shutter, 0, 0, W / 4, H / 4); glowContext.filter = 'none';
  out.globalCompositeOperation = 'screen'; out.globalAlpha = .16; out.drawImage(glow, 0, 0, W, H);
  out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1;
  // The vignette follows the short side, so a tall frame darkens its corners as much.
  const side = Math.min(W, H), vignette = out.createRadialGradient(W / 2, H / 2, side * .45, W / 2, H / 2, side * 1.08);
  vignette.addColorStop(0, rgb(BLACK, 0)); vignette.addColorStop(1, rgb(BLACK, .34));
  out.fillStyle = vignette; out.fillRect(0, 0, W, H);
  // Seeded grain after blur, moved to a new offset on every frame.
  out.globalCompositeOperation = 'soft-light'; out.globalAlpha = .11;
  const ox = Math.floor(hash(frame * 2 + 1) * 512), oy = Math.floor(hash(frame * 2 + 2) * 512);
  for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) out.drawImage(grain, x, y);
  out.globalCompositeOperation = 'source-over'; out.globalAlpha = 1;
  return Promise.resolve(samples);
}

/** Mean absolute difference, 0 to 255, between the rig at rest and the official mark. */
async function markDifference() {
  const size = 800, a = layer(size, size), b = layer(size, size);
  const image = new Image(); image.src = '/mark.svg'; await image.decode();
  // The mark's own colours are the dark Institutional palette.
  const D = project.brand.dark, inks = {ink: D.ink, accent: D.primary, surface: D.surface};
  for (const [el, drawMark] of [[a, true], [b, false]] as const) {
    const g = el.getContext('2d')!; g.fillStyle = rgb(inks.surface); g.fillRect(0, 0, size, size);
    if (drawMark) g.drawImage(image, 0, 0, size, size); else { g.scale(size / 80, size / 80); badger(g, REST, inks); }
  }
  const x = a.getContext('2d')!.getImageData(0, 0, size, size).data, y = b.getContext('2d')!.getImageData(0, 0, size, size).data;
  let total = 0;
  for (let i = 0; i < x.length; i += 4) total += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
  return total / (size * size * 3);
}

window.__REEL = {load, seek, markDifference};
