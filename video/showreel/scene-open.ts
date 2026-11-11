// Cold open. A name badge is built on the beat, comes alive as Badger, winds up
// and runs. The lines it leaves behind become the rules of the schedule.
import {type C, type Format, type Point, type Project, W, H, camera, spring, prog, outCubic, inCubic, outExpo, lerp, rgb, mix, line, ring, BLACK} from './kit.ts';
import {badger, REST, type Pose} from './badger.ts';
import {type Scene, ground, LAYOUT as SHARED, streaks, rule, SOFT} from './shared.ts';

/**
 * Frame-dependent positions. `origin` is the rig's top-left corner in world
 * space; the mark's centre is 240 px right of and below it. `keys` are the
 * camera framings [centre x, centre y, zoom], one for each cut: left eye, both
 * eyes, face (held while the badge is drawn), whole figure, wide.
 */
export const LAYOUT: Record<Format, {origin: Point; keys: [number, number, number][]}> = {
  landscape: {origin: [720, 300], keys: [[918, 558, 4.4], [954, 558, 3.7], [954, 579, 3.0], [954, 579, 3.0], [960, 528, 1.32], [960, 540, 1]]},
  // The mark's centre sits at (540, 880). The wide framing stays a little close,
  // so the figure still fills the narrow frame while he crouches.
  vertical: {origin: [300, 640], keys: [[498, 898, 4.4], [534, 898, 3.7], [534, 919, 3.0], [534, 919, 3.0], [540, 870, 1.2], [540, 880, 1.12]]},
};

export function open(p: Project): Scene {
  const q = p.clock.cues.open, D = p.brand.dark, end = p.clock.scenes[0].end;
  const inks = {ink: D.ink, accent: D.primary, surface: D.surface};
  const L = LAYOUT[p.format], S = SHARED[p.format];
  const UNIT = 6, [OX, OY] = L.origin;
  const keys = L.keys;
  const hits = [q.eyes[0], q.eyes[1], q.smile, q.badge, q.lanyard, q.windup];
  const launch = q.dash - 3;

  return {from: 0, to: end, draw(c: C, f: number) {
    let [cx, cy, zoom] = keys[0];
    // Each framing is a cut on the beat. A camera move across bright strokes is
    // a run of rises and falls for the flash screen; a cut is one change.
    for (let i = 1; i < keys.length; i++) if (f >= hits[i]) [cx, cy, zoom] = keys[i];
    const go = prog(f, launch, q.dash + 11);

    ground(c, D);
    const t4 = (f - q.lanyard) / 30;
    // The crouch is a pose change on the cut, then a hold.
    const wind = f >= q.windup ? 1 : 0;
    const pulse = (beat: number) => Math.max(0, 1 - Math.abs(f - beat - 2) / 4);
    const pose: Pose = {
      ...REST,
      eyes: [spring(f, q.eyes[0], 3.2, .42), spring(f, q.eyes[1], 3.2, .42)],
      smile: outCubic(prog(f, q.smile, q.smile + 9)),
      outline: outExpo(prog(f, q.badge, q.badge + 13)),
      fill: prog(f, q.badge + 2, q.badge + 9),
      band: outCubic(prog(f, q.badge + 4, q.badge + 13)),
      clip: spring(f, q.badge + 7, 3.4, .4),
      lanyard: outCubic(prog(f, q.lanyard, q.lanyard + 6)),
      swing: t4 > 0 ? 4 * Math.exp(-t4 * 7) * Math.cos(t4 * 15) : 0,
      limbs: outCubic(prog(f, q.lanyard + 3, q.lanyard + 10)),
      lean: (f >= q.lanyard ? .16 : 0) - .27 * wind + .58 * outCubic(prog(f, launch, launch + 5)),
      squash: 1 - .13 * Math.max(0, 1 - Math.abs(f - q.lanyard - 5) / 5) - .07 * wind - .06 * (pulse(q.windup) + pulse(q.windup + 14))
        + .12 * outCubic(prog(f, launch, launch + 4)),
      arm: -.75 * wind * (1 - prog(f, launch, launch + 3)),
      blink: Math.max(0, 1 - Math.abs(f - (q.windup + 21)) / 2.5),
      runAmount: prog(f, launch, launch + 3),
      run: Math.max(0, f - launch) / 30 * 4.4,
      bars: prog(f, q.lanyard + 6, q.lanyard + 11),
      barStretch: 1 + 16 * go,
    };
    const dx = -72 * wind + 3200 * inCubic(go);

    c.save(); camera(c, cx, cy, zoom);
    // The five rules trail from the runner; each keeps going until it spans the frame.
    // Each rule is placed so that, through the last framing, it lies on the
    // schedule rule of the next scene.
    if (f >= launch) {
      c.lineCap = 'round';
      S.railY.forEach((rail, i) => {
        const y = cy + (rail - H / 2) / zoom;
        const reach = outCubic(prog(f, launch + 2 + i * 1.5, end - 3 + i * .6));
        const settle = prog(f, end - 10, end);
        line(c, lerp(OX + dx, -200, outCubic(prog(f, launch, launch + 6))), y, lerp(OX + dx, W + 200, reach), y, rgb(mix(D.primary, rule(D), settle), lerp(.9, 1, settle)), lerp(5, 2, settle) / zoom);
      });
    }
    const feet = OY + 72 * UNIT + 8;
    const grounded = pose.limbs * (1 - go);
    if (grounded > 0) {
      c.save(); c.translate(OX + dx + 40 * UNIT, feet); c.scale(1, .16);
      const shade = c.createRadialGradient(0, 0, 0, 0, 0, 190);
      shade.addColorStop(0, rgb(BLACK, .5 * grounded)); shade.addColorStop(1, rgb(BLACK, 0));
      c.fillStyle = shade; c.beginPath(); c.arc(0, 0, 190, 0, Math.PI * 2); c.fill(); c.restore();
    }
    // At speed the runner is a dim streak: bright strokes do not cross the frame.
    c.save(); c.translate(OX + dx, OY); c.scale(UNIT, UNIT); badger(c, pose, inks, 1 - (1 - SOFT) * prog(f, launch, launch + 4)); c.restore();
    // A ring leaves each new part on its beat.
    const origins = [[33, 43], [45, 43], [39, 51], [39, 41], [39, 20]];
    origins.forEach(([x, y], i) => {
      const wave = prog(f, hits[i], hits[i] + 16);
      if (wave > 0 && wave < 1) ring(c, OX + x * UNIT, OY + y * UNIT, (i < 3 ? 22 : 150) + (i < 3 ? 90 : 260) * outExpo(wave), rgb(D.primary, SOFT * (1 - wave)), 4 * (1 - wave) / Math.sqrt(zoom));
    });
    c.restore();
    streaks(c, D.ink, go * (1 - prog(f, end - 8, end)), 11, f);
  }};
}
