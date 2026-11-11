// Shape. The style picker changes the whole site: six styles, each wiped in a
// different way, then the dark mode, then all twelve looks at once.
import {type C, type Format, type Project, W, H, spring, prog, outCubic, outExpo, inOutQuint, inQuint, clamp, lerp, rgb, mix, text, fillBox, strokeBox, disc, line, shadowed, BLACK} from './kit.ts';
import {type Scene, ground, word, sample, streaks, SOFT} from './shared.ts';
import {LAYOUT as PAGE} from './page.ts';

type Text = {x: number; y: number; size: number};
/**
 * Frame-dependent positions. `win` is the site window. The wall has `cols` by
 * `rows` tiles; with `crop` a tile shows the top of the page at the window's
 * scale, otherwise the whole page. `list` is the style picker (first baseline
 * and step). `under` is the row under the window: its drop below the window,
 * where the clip of the heading face starts, and `k`, the scale of its type and
 * switch. `pages` lists the page pictures of the wall in tile order; the last
 * one is the window's own page. `burst` is the centre and reach of
 * the circular wipe, and `dots` the grid of the dot wipe, in page pixels.
 */
export const LAYOUT: Record<Format, {
  win: {x: number; y: number; w: number; h: number}; tile: {w: number; h: number; gap: number; x: number; y: number; cols: number; rows: number}; crop: boolean;
  word: Text; list: Text & {step: number}; under: {drop: number; clip: number; k: number}; wall: Text & {pages: number[]}; burst: {x: number; y: number; r: number}; dots: {cols: number; rows: number};
}> = {
  landscape: {
    win: {x: 700, y: 150, w: 1120, h: 630}, tile: {w: 430, h: 242, gap: 24, x: 64, y: 84, cols: 4, rows: 3}, crop: false,
    word: {x: 108, y: 470, size: 196}, list: {x: 120, y: 560, step: 54, size: 38}, under: {drop: 56, clip: 400, k: 1},
    wall: {x: 960, y: 1010, size: 104, pages: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}, burst: {x: 1710, y: 68, r: 2150}, dots: {cols: 16, rows: 9},
  },
  // The picker sits beside the word. The page fills the safe width below them
  // and shows its top; the rest runs off as a long phone page does. The wall has
  // four styles in large tiles, light on the left and dark on the right, so a
  // phone can read them. It ends on Atlas dark, the window's own page.
  vertical: {
    win: {x: 60, y: 610, w: 960, h: 640}, tile: {w: 468, h: 268, gap: 24, x: 60, y: 390, cols: 2, rows: 4}, crop: true,
    word: {x: 60, y: 440, size: 196}, list: {x: 680, y: 292, step: 44, size: 40}, under: {drop: 62, clip: 330, k: 34 / 28},
    wall: {x: 540, y: 350, size: 100, pages: [0, 1, 2, 3, 6, 7, 10, 11]}, burst: {x: 985, y: 84, r: 1600}, dots: {cols: 9, rows: 11},
  },
};
export const wallStart = (p: Project) => p.clock.cues.shape.wall - Math.round(p.clock.beatFrames);

export function shape(p: Project, cache: HTMLCanvasElement[]): Scene {
  const q = p.clock.cues.shape, D = p.brand.dark, end = p.clock.scenes[2].end, enter = p.clock.cues.plan.wipe + 10;
  const styles = p.styles;
  const L = LAYOUT[p.format], WIN = L.win, TILE = L.tile, {w: PW, h: PH} = PAGE[p.format];
  // The wall builds one beat before its cue, so the caption lands on the swell.
  const grid = wallStart(p);
  const tile = (i: number) => ({x: TILE.x + (i % TILE.cols) * (TILE.w + TILE.gap), y: TILE.y + Math.floor(i / TILE.cols) * (TILE.h + TILE.gap), w: TILE.w, h: TILE.h});

  // Each wipe is a clip path in page coordinates.
  function wipe(c: C, kind: number, t: number) {
    c.beginPath();
    if (kind === 1) for (let k = 0; k < 10; k++) c.rect(k * PW / 10, 0, PW / 10 * clamp(t * 1.7 - k * .07) + 1, PH);
    else if (kind === 2) c.arc(L.burst.x, L.burst.y, t * L.burst.r, 0, Math.PI * 2);
    else if (kind === 3) { const edge = lerp(-340, PW + 340, t); c.moveTo(-600, 0); c.lineTo(edge + 320, 0); c.lineTo(edge - 320, PH); c.lineTo(-600, PH); c.closePath(); }
    else if (kind === 4) for (let k = 0; k < 8; k++) { const w = PW * clamp(t * 1.6 - k * .075); c.rect(k % 2 ? PW - w : 0, k * PH / 8, w, PH / 8 + 1); }
    else if (kind === 5) for (let row = 0; row < L.dots.rows; row++) for (let col = 0; col < L.dots.cols; col++) { const r = 88 * clamp(t * 2.4 - (col + row) * .058); if (r > 0) { c.moveTo(col * 120 + 60 + r, row * 120 + 60); c.arc(col * 120 + 60, row * 120 + 60, r, 0, Math.PI * 2); } }
    else c.rect(0, 0, PW * t, PH);
    c.clip();
  }

  function pageIn(c: C, rect: {x: number; y: number; w: number; h: number}, index: number, radius: number, f: number, live: boolean) {
    c.save();
    shadowed(c, 60, 28, .5, () => fillBox(c, rect.x, rect.y, rect.w, rect.h, radius, rgb(BLACK)));
    c.beginPath(); c.roundRect(rect.x, rect.y, rect.w, rect.h, radius); c.clip();
    // A cropped tile keeps the page's scale and shows its top; otherwise the whole page fits the rectangle.
    c.translate(rect.x, rect.y); c.scale(rect.w / PW, L.crop ? rect.w / PW : rect.h / PH); c.imageSmoothingQuality = 'high';
    if (!live) { c.drawImage(cache[index], 0, 0); c.restore(); return; }
    // The live window: find the latest change and wipe from the page before it.
    let current = 0, kind = 0, at = q.styles[0];
    q.styles.forEach((cue, i) => { if (f >= cue) { current = i * 2; kind = i; at = cue; } });
    if (f >= q.dark) { current = 11; kind = 6; at = q.dark; }
    const t = outExpo(prog(f, at, at + (kind === 6 ? 15 : 13)));
    if (kind && t < 1) {
      c.drawImage(cache[kind === 6 ? 10 : current - 2], 0, 0);
      c.save(); wipe(c, kind, t); c.drawImage(cache[current], 0, 0); c.restore();
      if (kind === 6) line(c, PW * t, 0, PW * t, PH, rgb(D.ink, SOFT * (1 - t)), 10);
    } else c.drawImage(cache[current], 0, 0);
    c.restore();
  }

  return {from: enter, to: end, draw(c: C, f: number) {
    const arrive = inOutQuint(prog(f, enter, q.styles[0])), leave = inQuint(prog(f, q.exit + 5, end));
    c.translate(W * (1 - arrive), -H * leave);
    ground(c, D);

    const wall = outCubic(prog(f, grid, grid + 7));
    const narrator = grid - 4;
    // Narrator column: the picker.
    word(c, 'Shape.', L.word.x, L.word.y, L.word.size, D.ink, f, q.styles[0] - 3, narrator);
    const listFade = outCubic(prog(f, q.styles[0] + 2, q.styles[0] + 14)) * (1 - prog(f, narrator, narrator + 6));
    if (listFade > 0) {
      let position = 0;
      for (let i = 1; i < 6; i++) position += spring(f, q.styles[i], 2.8, .6);
      styles.forEach((style, i) => {
        const active = clamp(1 - Math.abs(position - i));
        // The chosen style is set in full ink; no marker bar.
        text(c, style.label, L.list.x, L.list.y + i * L.list.step, {size: L.list.size, weight: 600, color: rgb(mix(D.inkMuted, D.ink, active), listFade * lerp(.72, 1, active))});
      });
    }

    // The site window, which becomes the last tile of the wall.
    const count = L.wall.pages.length, last = tile(count - 1), kickAt = [...q.styles, q.dark].reverse().find(cue => f >= cue) ?? q.styles[0];
    // A very small settle on each change; the bright window must not swing.
    const kick = .006 * (1 - outCubic(prog(f, kickAt, kickAt + 6)));
    const rect = {x: lerp(WIN.x, last.x, wall), y: lerp(WIN.y, last.y, wall), w: lerp(WIN.w, last.w, wall), h: lerp(WIN.h, last.h, wall)};
    if (f >= grid) for (let i = 0; i < count - 1; i++) {
      const t = tile(i), distance = TILE.cols - 1 - (i % TILE.cols) + TILE.rows - 1 - Math.floor(i / TILE.cols), pop = outCubic(prog(f, grid + 6 + distance, grid + 12 + distance));
      if (pop <= 0) continue;
      c.save(); c.translate(t.x + t.w / 2, t.y + t.h / 2); c.scale(lerp(.9, 1, pop), lerp(.9, 1, pop)); c.globalAlpha = pop;
      pageIn(c, {x: -t.w / 2, y: -t.h / 2, w: t.w, h: t.h}, L.wall.pages[i], 4, f, false); c.restore();
    }
    c.save(); c.translate(rect.x + rect.w / 2, rect.y + rect.h / 2); c.scale(1 + kick, 1 + kick);
    pageIn(c, {x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h}, 11, lerp(6, 4, wall), f, true); c.restore();

    // Under the window: the mode switch and the heading face in use.
    const under = outCubic(prog(f, q.styles[0] + 4, q.styles[0] + 14)) * (1 - prog(f, narrator, narrator + 5));
    if (under > 0) {
      const knob = spring(f, q.dark, 3, .55), sx = WIN.x, sy = WIN.y + WIN.h + L.under.drop, k = L.under.k;
      c.globalAlpha = under;
      text(c, 'Light', sx, sy + 9 * k, {size: 28 * k, weight: 600, color: rgb(mix(D.ink, D.inkMuted, knob))});
      fillBox(c, sx + 82 * k, sy - 20 * k, 84 * k, 44 * k, 22 * k, rgb(mix(D.surfaceAlt, D.primary, .25 + .75 * knob)));
      disc(c, sx + 104 * k + 40 * k * knob, sy + 2 * k, 16 * k, rgb(D.ink));
      text(c, 'Dark', sx + 184 * k, sy + 9 * k, {size: 28 * k, weight: 600, color: rgb(mix(D.inkMuted, D.ink, knob))});
      const press = prog(f, q.dark, q.dark + 14);
      if (press > 0 && press < 1) { c.beginPath(); c.arc(sx + 124 * k, sy + 2 * k, 30 * k + 60 * outCubic(press), 0, Math.PI * 2); c.strokeStyle = rgb(D.primary, SOFT * (1 - press)); c.lineWidth = 3; c.stroke(); }
      // The face name rolls over on each change.
      let index = 0;
      q.styles.forEach((cue, i) => { if (f >= cue) index = i; });
      const since = f - q.styles[index];
      c.save(); c.beginPath(); c.rect(WIN.x + L.under.clip, sy - 30 * k, WIN.w - L.under.clip, 56 * k); c.clip();
      const roll = outCubic(clamp(since / 8));
      if (index > 0 && roll < 1) text(c, `Headings: ${styles[index - 1].face}`, WIN.x + WIN.w, sy + 9 * k - roll * 50 * k, {size: 28 * k, weight: 600, align: 'right', color: rgb(D.inkMuted)});
      text(c, `Headings: ${styles[index].face}`, WIN.x + WIN.w, sy + 9 * k + (1 - roll) * 50 * k, {size: 28 * k, weight: 600, align: 'right', color: rgb(D.inkMuted)});
      c.restore(); c.globalAlpha = 1;
      strokeBox(c, WIN.x - 1, WIN.y - 1, WIN.w + 2, WIN.h + 2, 7, rgb(D.ink, .1 * under), 2);
    }
    word(c, 'Light and dark.', L.wall.x, L.wall.y, L.wall.size, D.ink, f, grid + 6, Infinity, 'center', .7);
    sample(c, p.copy.sample, D.inkMuted, arrive * (1 - prog(f, grid - 4, grid)));
    c.setTransform(1, 0, 0, 1, 0, 0);
    streaks(c, D.ink, Math.sin(Math.PI * prog(f, enter, q.styles[0])) * .8, 23, f);
  }};
}
