// Pieces every scene uses: the dark ground, the narrator's type, and the layout
// values two neighbouring scenes must agree on.
import {type C, type Palette, type RGB, W, H, rgb, mix, text, kinetic, prog, outCubic, clamp, lerp, disc, hash, TAU} from './kit.ts';

export type Scene = {from: number; to: number; draw: (c: C, f: number) => void};

// The opening speed lines come to rest as the rules of the schedule.
export const RAIL_Y = [160, 338, 516, 694, 872];
export const RAIL_X0 = 700, RAIL_X1 = 1800;

export const rule = (p: Palette, amount = .2): RGB => mix(p.surface, p.ink, amount);

/** Dark brand ground with a dot grid that moves with the camera, for depth. */
export function ground(c: C, p: Palette, cx = W / 2, cy = H / 2, zoom = 1, glowAt: [number, number] = [W * .62, H * .42], glow = 1) {
  c.fillStyle = rgb(p.surface); c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(glowAt[0], glowAt[1], 0, glowAt[0], glowAt[1], W * .62);
  g.addColorStop(0, rgb(p.primary, .13 * glow)); g.addColorStop(.5, rgb(p.primary, .04 * glow)); g.addColorStop(1, rgb(p.primary, 0));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // Far layer: the grid moves at 35% of the camera, so near things pass it.
  const depth = .35, step = 64 * lerp(1, zoom, depth), ox = W / 2 - cx * depth * lerp(1, zoom, depth), oy = H / 2 - cy * depth * lerp(1, zoom, depth);
  c.fillStyle = rgb(p.ink, .075);
  const x0 = ((ox % step) + step) % step, y0 = ((oy % step) + step) % step;
  for (let y = y0 - step; y < H + step; y += step) for (let x = x0 - step; x < W + step; x += step) { c.beginPath(); c.arc(x, y, 1.6, 0, TAU); c.fill(); }
}

/**
 * Opacity limit for anything bright that travels: rings, rays, trails, streaks.
 * A bright shape that moves is a rise at its front and a fall at its back, and
 * the flash screen counts each pair. At this opacity over the dark ground the
 * change stays under the screen's threshold of 0.1 linear light.
 */
export const SOFT = .3;

/**
 * A large narrator word. Each letter is uncovered from its baseline upward and
 * stays where it is, so bright type appears without travelling.
 */
export function word(c: C, value: string, x: number, y: number, size: number, color: RGB, f: number, start: number, leave = Infinity, align: CanvasTextAlign = 'left', stagger = 1.5) {
  if (f < start) return;
  const out = prog(f, leave, leave + 7);
  if (out >= 1) return;
  kinetic(c, value, x, y, {family: 'Bricolage', weight: 800, size, tracking: -size * .022, align, color: rgb(color, 1 - out)}, (i, _n, glyph) => {
    const r = outCubic(prog(f, start + i * stagger, start + i * stagger + 9));
    if (r <= 0) return false;
    c.beginPath(); c.rect(-glyph.w, size * .3 - size * 1.3 * r, glyph.w * 2, size * 1.3 * r); c.clip();
    c.translate(0, (1 - r) * size * .05);
  });
}

/** Small mono chapter label, typed on one character per frame. */
export function folio(c: C, value: string, x: number, y: number, color: RGB, f: number, start: number, leave = Infinity, size = 24) {
  // Whole characters, counted from the whole frame: no half-drawn glyph in the shutter.
  const shown = Math.floor(clamp((Math.floor(f) - start) * 1.4, 0, value.length));
  const alpha = 1 - prog(f, leave, leave + 6);
  if (shown <= 0 || alpha <= 0) return;
  text(c, value.slice(0, shown).toUpperCase(), x, y, {family: 'Mono', weight: 500, size, tracking: size * .12, color: rgb(color, alpha)});
}

/** Line of narrator copy: words fade up in turn. */
export function phrase(c: C, value: string, x: number, y: number, o: {size: number; color: RGB; weight?: number; family?: string; align?: CanvasTextAlign}, f: number, start: number, leave = Infinity, stagger = 2.2) {
  const words = value.split(' ');
  const out = prog(f, leave, leave + 7);
  if (f < start || out >= 1) return;
  const options = {family: o.family ?? 'Source', weight: o.weight ?? 600, size: o.size};
  c.save(); c.font = `${options.weight} ${options.size}px ${options.family}`; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const space = c.measureText(' ').width, widths = words.map(w => c.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  let cursor = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
  words.forEach((w, i) => {
    const s = outCubic(prog(f, start + i * stagger, start + i * stagger + 9));
    c.fillStyle = rgb(o.color, s * (1 - out)); c.fillText(w, cursor, y + (1 - s) * o.size * .35);
    cursor += widths[i] + space;
  });
  c.restore();
}

/** The standing note that the event shown is invented. */
export function sample(c: C, label: string, color: RGB, alpha: number) {
  if (alpha <= 0) return;
  text(c, label.toUpperCase(), 120, 1012, {family: 'Mono', weight: 400, size: 19, tracking: 2.2, color: rgb(color, .85 * alpha)});
}

/** Circle with initials. The films show no faces. */
export function initials(c: C, name: string, x: number, y: number, r: number, fill: RGB, ink: RGB, alpha = 1) {
  if (r <= 0) return;
  disc(c, x, y, r, rgb(fill, alpha));
  const letters = name.split(' ').map(part => part[0]).join('').slice(0, 2);
  text(c, letters, x, y + r * .05, {family: 'Source', weight: 700, size: r * .86, align: 'center', baseline: 'middle', color: rgb(ink, alpha)});
}

/** Short seeded streaks for fast moves. `amount` is 0 to 1. */
export function streaks(c: C, color: RGB, amount: number, seed: number, f: number, direction = -1) {
  if (amount <= 0) return;
  c.save(); c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y = hash(seed + i * 7) * H, speed = 90 + hash(seed + i * 13) * 150, length = 120 + hash(seed + i * 5) * 520;
    const x = (((hash(seed + i * 3) * (W + 1200) + direction * f * speed) % (W + 1200)) + (W + 1200)) % (W + 1200) - 600;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - direction * length * amount, y);
    c.strokeStyle = rgb(color, (.08 + hash(seed + i) * (SOFT - .08)) * amount); c.lineWidth = 1 + hash(seed + i * 11) * 3; c.stroke();
  }
  c.restore();
}
