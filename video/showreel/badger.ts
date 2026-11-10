// Badger, the running name badge, as a rig. REST draws the official mark from
// design/brand/badger-mark.svg point for point; render.mjs --check-mark proves it.
// Units are the mark's own 80 by 80 drawing space.
import {type C, type RGB, type Point, rgb, clamp, lerp, TAU, quadPoints, trace} from './kit.ts';

export type Pose = {
  /** Forward slant. The mark uses 0.16; 0 is an upright badge. */
  lean: number;
  /** Run cycle position in strides, and how much of the cycle replaces the rest pose. */
  run: number; runAmount: number;
  /** Vertical squash about the feet; 1 is none. */
  squash: number;
  blink: number; arm: number;
  /** Lanyard drawn from the top down, and the sideways sway of its ends. */
  lanyard: number; swing: number;
  /** Speed bars: how much is drawn, and a length multiplier. */
  bars: number; barStretch: number;
  eyes: [number, number]; smile: number; outline: number; fill: number; band: number; clip: number; limbs: number;
  /** Opacity of legs and arm. Fast limbs are drawn soft, as a smear. */
  limbAlpha: number;
};
export const REST: Pose = {lean: .16, run: 0, runAmount: 0, squash: 1, blink: 0, arm: 0, lanyard: 1, swing: 0, bars: 1, barStretch: 1, eyes: [1, 1], smile: 1, outline: 1, fill: 1, band: 1, clip: 1, limbs: 1, limbAlpha: 1};
export type Inks = {ink: RGB; accent: RGB; surface: RGB};

// Knee, ankle and toe as offsets from the hip. FORWARD and KICK are the two
// legs of the mark; DOWN and PASS complete a stride.
type Leg = [Point, Point, Point];
const FORWARD: Leg = [[4.5, 6], [9, 12], [14, 10]];
const DOWN: Leg = [[1.5, 6.5], [1, 13], [5.5, 13.5]];
const KICK: Leg = [[-7, 10], [-14, 7], [-15, 9]];
const PASS: Leg = [[4, 7], [-3, 8.5], [-1, 11]];
const STRIDE = [FORWARD, DOWN, KICK, PASS];
const BAND = 'M24.25 28a3.75 3.75 0 0 1 3.75-3.75h22A3.75 3.75 0 0 1 53.75 28v4.75h-29.5Z';

function catmull(a: number, b: number, d: number, e: number, t: number) {
  return .5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t);
}
function stride(phase: number): Leg {
  const p = ((phase % 1) + 1) % 1 * 4, i = Math.floor(p), t = p - i;
  const key = (k: number) => STRIDE[((i + k) % 4 + 4) % 4];
  return [0, 1, 2].map(joint => [0, 1].map(axis => catmull(key(-1)[joint][axis], key(0)[joint][axis], key(1)[joint][axis], key(2)[joint][axis], t))) as Leg;
}
function leg(hip: Point, rest: Leg, phase: number, amount: number): Point[] {
  const moving = stride(phase);
  return [hip, ...rest.map((p, i) => [hip[0] + lerp(p[0], moving[i][0], amount), hip[1] + lerp(p[1], moving[i][1], amount)] as Point)];
}
/** Back leg, front leg and arm as point lists, in mark units. */
export function limbs(pose: Pose): Point[][] {
  const angle = pose.arm + pose.runAmount * .9 * Math.sin(TAU * pose.run);
  return [
    leg([31, 59], KICK, pose.run + .5, pose.runAmount),
    leg([43, 59], FORWARD, pose.run, pose.runAmount),
    [[54, 42], [54 + 8 * Math.cos(angle) + 8 * Math.sin(angle), 42 - 8 * Math.cos(angle) + 8 * Math.sin(angle)]],
  ];
}
function polyline(c: C, points: Point[]) {
  c.beginPath(); points.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
}

/** Draws Badger with the caller's transform: one unit is one mark unit. */
export function badger(c: C, pose: Pose, inks: Inks, alpha = 1) {
  const ink = rgb(inks.ink, alpha), accent = rgb(inks.accent, alpha);
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (pose.bars > 0) {
    c.strokeStyle = accent; c.lineWidth = 3.5;
    for (const [right, y, length] of [[14, 44, 7], [12, 50, 4]]) {
      c.beginPath(); c.moveTo(right, y); c.lineTo(right - length * clamp(pose.bars) * pose.barStretch, y); c.stroke();
    }
  }
  c.translate(40, 72); c.scale(1 / Math.sqrt(pose.squash), pose.squash); c.translate(-40, -72);
  c.translate(0, -.6 * pose.runAmount * Math.abs(Math.sin(TAU * pose.run)));
  c.transform(1, 0, -pose.lean, 1, 50 * pose.lean, 0);

  if (pose.lanyard > 0) {
    const left: Point = [28 + pose.swing, 6], right: Point = [50 + pose.swing * .8, 6], clip: Point = [40, 23];
    c.strokeStyle = accent; c.lineWidth = 3.5;
    if (pose.lanyard >= 1) { polyline(c, [left, clip, right]); c.stroke(); } else {
      trace(c, [left, clip], 0, pose.lanyard, accent, 3.5);
      trace(c, [right, clip], 0, pose.lanyard, accent, 3.5);
    }
  }
  if (pose.limbs > 0) {
    const soft = rgb(inks.ink, alpha * pose.limbAlpha);
    for (const limb of limbs(pose)) {
      if (pose.limbs >= 1) { polyline(c, limb); c.strokeStyle = soft; c.lineWidth = 2.8; c.stroke(); } else trace(c, limb, 0, pose.limbs, soft, 2.8);
    }
  }
  if (pose.fill > 0) { c.beginPath(); c.roundRect(23, 23, 32, 36, 5); c.fillStyle = rgb(inks.surface, alpha * clamp(pose.fill)); c.fill(); }
  if (pose.outline > 0) {
    const perimeter = 2 * (32 + 36) - 8 * 5 + TAU * 5;
    c.beginPath(); c.roundRect(23, 23, 32, 36, 5);
    if (pose.outline < 1) c.setLineDash([perimeter * pose.outline, perimeter]);
    c.strokeStyle = ink; c.lineWidth = 2.5; c.stroke(); c.setLineDash([]);
  }
  if (pose.band > 0) {
    c.save();
    if (pose.band < 1) { c.beginPath(); c.rect(23, 23, 32 * pose.band, 12); c.clip(); }
    c.fillStyle = accent; c.fill(new Path2D(BAND)); c.restore();
  }
  if (pose.clip > 0) {
    c.save(); c.translate(39, 21.5); c.scale(pose.clip, pose.clip);
    c.beginPath(); c.roundRect(-4, -3.5, 8, 7, 1.5); c.fillStyle = ink; c.fill(); c.restore();
  }
  pose.eyes.forEach((amount, i) => {
    if (amount <= 0) return;
    c.save(); c.translate(i ? 45 : 33, 43); c.scale(amount, amount * (1 - .92 * clamp(pose.blink)));
    c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fillStyle = ink; c.fill(); c.restore();
  });
  if (pose.smile > 0) trace(c, quadPoints([34, 50], [39, 54], [44, 50]), 0, pose.smile, ink, 2.5);
  c.restore();
}

/**
 * The face-only icon, from docs/favicon.svg, in its 24-unit space. `checked`
 * fills the badge and draws the smile; an unchecked badge waits with eyes only.
 */
export function face(c: C, inks: Inks, checked: number, alpha = 1) {
  const ink = rgb(inks.ink, alpha);
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.roundRect(3, 4.5, 18, 18, 4); c.fillStyle = rgb(inks.surface, alpha); c.fill();
  c.strokeStyle = ink; c.lineWidth = 2; c.stroke();
  c.fillStyle = rgb(inks.accent, alpha * lerp(.28, 1, clamp(checked))); c.fill(new Path2D('M4 8.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3V10H4Z'));
  c.beginPath(); c.roundRect(9, 1, 6, 5.5, 1.2); c.fillStyle = ink; c.fill();
  for (const x of [8.5, 15.5]) { c.beginPath(); c.arc(x, 13.75, 1.65, 0, TAU); c.fill(); }
  if (checked > 0) trace(c, quadPoints([8.5, 18.25], [12, 21.25], [15.5, 18.25]), 0, checked, ink, 2);
  c.restore();
}
