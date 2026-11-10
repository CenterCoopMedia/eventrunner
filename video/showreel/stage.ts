// Orders the scenes. A scene draws while the frame is inside its window; windows
// overlap where one scene wipes over the last.
import {type C, type Project, W, H, rgb} from './kit.ts';
import type {Scene} from './shared.ts';
import {open} from './scene-open.ts';
import {plan} from './scene-plan.ts';
import {shape, wallStart} from './scene-shape.ts';
import {gather} from './scene-gather.ts';
import {stack} from './scene-stack.ts';
import {montage} from './scene-montage.ts';
import {title} from './scene-title.ts';
import {pages} from './page.ts';

/** How far a dip covers the picture with the ground colour. */
const DIP = .74;

export type Stage = {samples: (frame: number) => number; draw: (c: C, f: number) => void};

export function createStage(p: Project): Stage {
  // The twelve page pictures are drawn once and shared.
  const site = pages(p);
  const scenes: Scene[] = [open(p), plan(p), shape(p, site), gather(p), stack(p, site[0]), montage(p), title(p)];
  const q = p.clock.cues, at = p.clock.scenes;
  // Windows of fast movement get a denser shutter, so blur does not band.
  const fast: [number, number][] = [
    [q.open.dash - 6, at[1].start + 16], [q.plan.push - 1, q.plan.push + 12], [q.plan.lift - 6, q.plan.lift + 10],
    [q.plan.wipe + 8, at[2].start + 4], [wallStart(p) - 1, wallStart(p) + 14], [q.shape.exit, at[3].start + 8],
    [q.gather.tear - 1, q.gather.tear + 12], [at[3].end - 12, at[4].start + 10], [q.stack.merge - 2, q.stack.merge + 16],
    [at[4].end - 15, q.title.land + 22],
  ];
  // Exposure dips: the picture goes dim for each large move and comes back at
  // rest. Bright shapes then never travel far while bright, which is what the
  // flash screen counts. Each window is [first frame, last frame] fully dim.
  const dips: [number, number][] = [
    [q.plan.push - 1, q.plan.push + 9], [q.plan.lift - 5, q.plan.lift + 7], [q.plan.wipe + 11, at[2].start - 3],
    [wallStart(p) - 1, wallStart(p) + 7], [q.shape.exit + 7, at[3].start - 2], [at[3].end - 9, at[3].end - 1],
    [q.stack.merge - 1, q.stack.merge + 9], [at[4].end - 11, at[4].end - 1], [q.montage.panels[7] + 2, q.montage.implode],
  ];
  const dip = (f: number) => Math.max(0, ...dips.map(([a, b]) => Math.min(1, (f - a + 3) / 3, (b + 4 - f) / 4)));
  const ground = rgb(p.brand.dark.surface);
  return {
    // Motion blur until the end card is still. Counts are powers of two for the shutter in main.ts.
    samples: frame => (frame >= p.clock.settle ? 1 : fast.some(([a, b]) => frame >= a && frame <= b) ? 16 : 8),
    draw(c, f) {
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none';
      c.fillStyle = 'black'; c.fillRect(0, 0, W, H);
      for (const scene of scenes) if (f >= scene.from && f < scene.to) { c.save(); scene.draw(c, f); c.restore(); }
      const dim = dip(f);
      if (dim > 0) { c.globalAlpha = DIP * dim; c.fillStyle = ground; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    },
  };
}
