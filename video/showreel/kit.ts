// Shared maths and drawing for the showreel. Every value is a function of the
// requested frame: no wall clock, no unseeded random numbers.
import type {Timeline} from './timeline.ts';
import type {Experience} from '../types.ts';

export const W = 1920, H = 1080;
export type C = CanvasRenderingContext2D;
export type RGB = number[];
export type Point = [number, number];
export type Palette = {surface: RGB; surfaceAlt: RGB; ink: RGB; inkMuted: RGB; primary: RGB; accent: RGB; highlight: RGB};
export type Style = {id: string; label: string; font: string; weight: number; face: string; radius: string; light: Palette; dark: Palette};
export type Project = {clock: Timeline; experience: Experience & {subtitle: string}; copy: {sample: string; day: string; days: number; site: string}; styles: Style[]; brand: {light: Palette; dark: Palette}};

export const TAU = Math.PI * 2;
export const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Linear progress of frame f through [a, b], held at 0 and 1 outside. */
export const prog = (f: number, a: number, b: number) => (f <= a ? 0 : f >= b ? 1 : (f - a) / (b - a));
export const outCubic = (t: number) => 1 - (1 - clamp(t)) ** 3;
export const inCubic = (t: number) => clamp(t) ** 3;
export const inOutCubic = (t: number) => { t = clamp(t); return t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
export const inQuint = (t: number) => clamp(t) ** 5;
export const inOutQuint = (t: number) => { t = clamp(t); return t < .5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2; };
export const outExpo = (t: number) => { t = clamp(t); return t >= 1 ? 1 : 1 - 2 ** (-10 * t); };
export const inExpo = (t: number) => { t = clamp(t); return t <= 0 ? 0 : 2 ** (10 * t - 10); };

/** Underdamped spring from 0 to 1 that starts at frame `start`. */
export function spring(f: number, start: number, freq = 2.4, damp = .5) {
  const t = (f - start) / 30;
  if (t <= 0) return 0;
  const w = TAU * freq, wd = w * Math.sqrt(1 - damp * damp);
  return 1 - Math.exp(-damp * w * t) * (Math.cos(wd * t) + damp * w / wd * Math.sin(wd * t));
}
/** Integer hash to [0, 1): the same on every machine. */
export function hash(n: number) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export const rgb = (c: RGB, a = 1) => a >= 1 ? `rgb(${c[0]} ${c[1]} ${c[2]})` : `rgb(${c[0]} ${c[1]} ${c[2]} / ${Math.max(0, a)})`;
export const mix = (a: RGB, b: RGB, t: number) => a.map((v, i) => Math.round(lerp(v, b[i], clamp(t))));
export const BLACK: RGB = [0, 0, 0];

export function camera(c: C, cx: number, cy: number, zoom: number, rotation = 0) {
  c.translate(W / 2, H / 2); c.rotate(rotation); c.scale(zoom, zoom); c.translate(-cx, -cy);
}
export function box(c: C, x: number, y: number, w: number, h: number, r = 0) {
  c.beginPath();
  if (r > 0) c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else c.rect(x, y, w, h);
}
export function fillBox(c: C, x: number, y: number, w: number, h: number, r: number, color: string) {
  box(c, x, y, w, h, r); c.fillStyle = color; c.fill();
}
export function strokeBox(c: C, x: number, y: number, w: number, h: number, r: number, color: string, width = 2) {
  box(c, x, y, w, h, r); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
export function disc(c: C, x: number, y: number, r: number, color: string) {
  if (r <= 0) return;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = color; c.fill();
}
export function ring(c: C, x: number, y: number, r: number, color: string, width: number) {
  if (r <= 0 || width <= 0) return;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
export function line(c: C, x0: number, y0: number, x1: number, y1: number, color: string, width = 2) {
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

export type TextOptions = {family?: string; size?: number; weight?: number; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; tracking?: number};
export function setFont(c: C, o: TextOptions) {
  c.font = `${o.weight ?? 700} ${o.size ?? 32}px ${o.family ?? 'Source'}`;
  c.letterSpacing = `${o.tracking ?? 0}px`;
  c.textAlign = o.align ?? 'left'; c.textBaseline = o.baseline ?? 'alphabetic';
  if (o.color) c.fillStyle = o.color;
}
export function text(c: C, value: string, x: number, y: number, o: TextOptions) {
  setFont(c, o); c.fillText(value, x, y); c.letterSpacing = '0px';
}
export function width(c: C, value: string, o: TextOptions) {
  setFont(c, {...o, align: 'left'});
  const w = c.measureText(value).width; c.letterSpacing = '0px';
  return w;
}
/**
 * Draws a line of type one glyph at a time. `each` moves glyph i before it is
 * drawn at the origin; return false to skip it. Kerning is kept, because each
 * glyph sits at its measured position in the whole line.
 */
export function kinetic(c: C, value: string, x: number, y: number, o: TextOptions, each: (i: number, n: number, glyph: {x: number; w: number}) => boolean | void) {
  setFont(c, {...o, align: 'left'});
  const total = c.measureText(value).width;
  const left = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
  const chars = [...value];
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    const before = c.measureText(prefix).width; prefix += chars[i];
    const w = c.measureText(prefix).width - before;
    if (chars[i] === ' ') continue;
    c.save(); c.translate(left + before + w / 2, y);
    if (each(i, chars.length, {x: left + before, w}) !== false) { c.textAlign = 'center'; c.fillText(chars[i], 0, 0); }
    c.restore();
  }
  c.letterSpacing = '0px';
}
/** Wraps to lines no wider than `max`. */
export function wrap(c: C, value: string, max: number, o: TextOptions) {
  setFont(c, {...o, align: 'left'});
  const lines: string[] = []; let current = '';
  for (const word of value.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && c.measureText(next).width > max) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  c.letterSpacing = '0px';
  return lines;
}

/** Point lists for curves, so strokes can be drawn on and objects can follow them. */
export function quadPoints(a: Point, b: Point, d: Point, steps = 24): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) { const t = i / steps, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * d[0], u * u * a[1] + 2 * u * t * b[1] + t * t * d[1]]); }
  return out;
}
export function along(points: Point[], t: number): Point {
  t = clamp(t);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const target = lengths[lengths.length - 1] * t;
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= target) {
      const span = lengths[i] - lengths[i - 1] || 1, k = (target - lengths[i - 1]) / span;
      return [lerp(points[i - 1][0], points[i][0], k), lerp(points[i - 1][1], points[i][1], k)];
    }
  }
  return points[points.length - 1];
}
/** Strokes the part of a polyline between fractions `from` and `to` of its length. */
export function trace(c: C, points: Point[], from: number, to: number, color: string, lineWidth: number) {
  from = clamp(from); to = clamp(to);
  if (to <= from) return;
  const steps = Math.max(2, Math.ceil(points.length * 2 * (to - from)));
  c.beginPath();
  for (let i = 0; i <= steps; i++) { const p = along(points, lerp(from, to, i / steps)); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
  c.strokeStyle = color; c.lineWidth = lineWidth; c.stroke();
}

/** A soft drop shadow under whatever `draw` fills. Blur is in output pixels. */
export function shadowed(c: C, blur: number, offsetY: number, alpha: number, draw: () => void) {
  c.save(); c.shadowColor = rgb(BLACK, alpha); c.shadowBlur = blur; c.shadowOffsetY = offsetY; draw(); c.restore();
}
