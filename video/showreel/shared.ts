// Pieces every scene uses: the dark ground, the narrator's type, and the layout
// values two neighbouring scenes must agree on.
import {type C, type Format, type Palette, type RGB, FORMAT, W, H, rgb, mix, text, kinetic, prog, outCubic, disc, hash} from './kit.ts';

export type Scene = {from: number; to: number; draw: (c: C, f: number) => void};

/**
 * Layout values two neighbouring scenes must agree on, for each format. The
 * opening speed lines come to rest as the rules of the schedule (`railY`, from
 * `railX0` to `railX1`). `sample` is the left end of the standing note's baseline.
 */
export const LAYOUT: Record<Format, {railY: number[]; railX0: number; railX1: number; sample: {x: number; y: number}}> = {
  landscape: {railY: [160, 338, 516, 694, 872], railX0: 700, railX1: 1800, sample: {x: 120, y: 1014}},
  // On a phone the rules run the width of the safe area, under the scene word.
  vertical: {railY: [700, 900, 1100, 1300, 1500], railX0: 60, railX1: 1020, sample: {x: 60, y: 1536}},
};

export const rule = (p: Palette, amount = .2): RGB => mix(p.surface, p.ink, amount);

/** The dark brand ground: one flat colour. No glow and no pattern. */
export function ground(c: C, p: Palette) {
  c.fillStyle = rgb(p.surface); c.fillRect(0, 0, W, H);
}

/**
 * One colour for each part of the product, from the style presets. The stack
 * and the montage use the same list, so a part keeps its colour.
 */
export const PARTS: [string, number, 'primary' | 'accent' | 'highlight' | 'ink'][] = [
  ['Pages', 0, 'primary'], ['Schedule', 4, 'primary'], ['Speakers', 3, 'primary'], ['Tickets', 5, 'primary'],
  ['Check-in', 2, 'highlight'], ['Email', 4, 'accent'], ['Sponsors', 3, 'accent'], ['Styles', 0, 'ink'],
];

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

/** The standing note that the event shown is invented, at a size a person can read. */
export function sample(c: C, label: string, color: RGB, alpha: number) {
  if (alpha <= 0) return;
  text(c, label, LAYOUT[FORMAT].sample.x, LAYOUT[FORMAT].sample.y, {family: 'Source', weight: 400, size: 26, color: rgb(color, alpha)});
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
