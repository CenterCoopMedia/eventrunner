// One site. The parts float as an exploded stack, each named in turn. On the
// build they close one by one, turn to face the viewer and become the page.
import {type C, type Format, type Project, type RGB, type Point, spring, prog, outCubic, inExpo, inOutCubic, clamp, lerp, rgb, mix, text, fillBox, strokeBox, disc, line, shadowed, BLACK} from './kit.ts';
import {type Scene, ground, phrase, sample, word, SOFT, PARTS} from './shared.ts';

import {LAYOUT as PAGE} from './page.ts';

type Text = {x: number; y: number; size: number};
/** Plate artwork is drawn in this space, then scaled to the plate. */
const ART = {w: 640, h: 400};
/**
 * Frame-dependent positions. Plates are `plate` in size, `gap` apart, with the
 * bottom plate centred on `centre`. On the merge they become `win`. `push` is
 * the point the last push goes through. `label` is the x of the part names.
 * `ring` places the soft ring of each closing gap: a rise above the centre and
 * its start radius and growth.
 */
export const LAYOUT: Record<Format, {
  plate: {w: number; h: number}; gap: number; centre: {x: number; y: number}; win: {x: number; y: number; w: number; h: number};
  push: {x: number; y: number}; label: number; ring: {dy: number; r0: number; dr: number}; lines: [Text, Text]; note: Text;
}> = {
  landscape: {
    plate: {w: 640, h: 400}, gap: 104, centre: {x: 1130, y: 700}, win: {x: 700, y: 170, w: 1120, h: 630},
    push: {x: 1260, y: 420}, label: 1570, ring: {dy: -150, r0: 300, dr: 320},
    lines: [{x: 108, y: 400, size: 104}, {x: 108, y: 520, size: 104}], note: {x: 120, y: 610, size: 44},
  },
  // The stack stands left of centre with the names on its right. It merges into
  // the phone window of the shape scene.
  vertical: {
    plate: {w: 560, h: 350}, gap: 120, centre: {x: 440, y: 1380}, win: {x: 190, y: 640, w: 700, h: 700 * PAGE.vertical.h / PAGE.vertical.w},
    push: {x: 540, y: 860}, label: 800, ring: {dy: -150, r0: 260, dr: 280},
    lines: [{x: 60, y: 360, size: 104}, {x: 60, y: 470, size: 104}], note: {x: 60, y: 550, size: 44},
  },
};

export function stack(p: Project, site: HTMLCanvasElement): Scene {
  const q = p.clock.cues.stack, D = p.brand.dark, [start, end] = [p.clock.scenes[4].start, p.clock.scenes[4].end];
  const L = LAYOUT[p.format], PW = L.plate.w, PH = L.plate.h, GAP = L.gap, CX = L.centre.x, CY = L.centre.y, WIN = L.win;
  // Five of the parts, with the colours the montage also gives them.
  const parts = [0, 1, 2, 3, 5].map(i => PARTS[i]);
  const accent = parts.map(([, style, key]) => p.styles[style].dark[key]), LABELS = parts.map(([name]) => name);
  // Grey artwork stays close to the plate, so only the accents count as bright.
  const bar = (): RGB => mix(D.surfaceAlt, D.ink, .22);

  // Plate artwork, in art space: x from -320 to 320, y from -200 to 200.
  const art: ((c: C, a: RGB) => void)[] = [
    (c, a) => {
      fillBox(c, -280, -160, 560, 26, 6, rgb(a)); fillBox(c, -280, -110, 300, 190, 10, rgb(a, .35));
      fillBox(c, 44, -110, 236, 86, 10, rgb(bar())); fillBox(c, 44, -6, 236, 86, 10, rgb(bar()));
      for (let i = 0; i < 2; i++) fillBox(c, -280, 108 + i * 30, 560 - i * 180, 14, 7, rgb(bar()));
    },
    (c, a) => { for (let i = 0; i < 4; i++) { fillBox(c, -280, -150 + i * 82, 86, 54, 8, rgb(a, i === 1 ? 1 : .45)); fillBox(c, -170, -146 + i * 82, 450 - (i % 2) * 110, 18, 9, rgb(bar())); fillBox(c, -170, -116 + i * 82, 220, 12, 6, rgb(bar(), .6)); } },
    (c, a) => { for (let i = 0; i < 4; i++) { disc(c, -210 + i * 140, -40, 52, rgb(a, i === 2 ? 1 : .45)); fillBox(c, -260 + i * 140, 44, 100, 14, 7, rgb(bar())); fillBox(c, -245 + i * 140, 72, 70, 10, 5, rgb(bar(), .6)); } },
    (c, a) => {
      for (let i = 0; i < 2; i++) {
        const y = -150 + i * 160;
        fillBox(c, -280, y, 560, 130, 14, rgb(a, i ? .4 : 1));
        for (let k = 0; k < 6; k++) disc(c, 150, y + 14 + k * 20.5, 5, rgb(D.surfaceAlt));
        fillBox(c, -250, y + 32, 260, 20, 10, rgb(D.surface, .55)); fillBox(c, -250, y + 70, 170, 14, 7, rgb(D.surface, .4));
      }
    },
    (c, a) => {
      strokeBox(c, -280, -150, 250, 170, 12, rgb(a), 8);
      c.beginPath(); c.moveTo(-272, -140); c.lineTo(-155, -50); c.lineTo(-38, -140); c.strokeStyle = rgb(a); c.lineWidth = 8; c.lineJoin = 'round'; c.stroke();
      for (let i = 0; i < 4; i++) fillBox(c, 10, -140 + i * 44, 270 - (i % 3) * 60, 16, 8, rgb(bar()));
      fillBox(c, -280, 70, 560, 16, 8, rgb(bar(), .6)); fillBox(c, -280, 110, 380, 16, 8, rgb(bar(), .6));
    },
  ];

  return {from: start, to: end, draw(c: C, f: number) {
    const explode = spring(f, q.explode, 1.7, .55);
    const merge = spring(f, q.merge, 2.6, .92), flat = clamp(merge);
    // Plates travel dim and light up at rest; the page lights after the turn.
    // On the build the artwork goes dim once, and the plates close as outlines.
    const lit = lerp(SOFT + .1, 1, prog(f, q.explode + 12, q.explode + 20)) * lerp(1, SOFT, prog(f, q.compress[0] - 5, q.compress[0] - 2));
    const page = prog(f, q.merge + 9, q.merge + 15);
    const through = inExpo(prog(f, end - 13, end));
    const push = 1 + through * 7;
    // Each closing gap gives the frame a small knock.
    let knock = 0;
    for (const cue of [...q.compress, q.merge]) knock += Math.max(0, 1 - Math.abs(f - cue - 1.5) / 4) * (cue === q.merge ? 9 : 5);
    ground(c, D);
    c.save(); c.translate(L.push.x, L.push.y + knock); c.scale(push, push); c.translate(-L.push.x, -L.push.y); c.globalAlpha = 1 - prog(f, end - 5, end);

    const theta = lerp((38 + 7 * inOutCubic(prog(f, start, q.merge))) * Math.PI / 180, 0, merge);
    const tilt = lerp(.5, 1, merge);
    const elevation = (i: number) => {
      let z = 0;
      for (let g = 0; g < i; g++) z += GAP * explode * (1 - outCubic(prog(f, q.compress[g], q.compress[g] + 4)));
      return z * (1 - flat);
    };
    const size = {w: lerp(PW, WIN.w, merge), h: lerp(PH, WIN.h, merge)};
    const cx = lerp(CX, WIN.x + WIN.w / 2, merge), cy = lerp(CY, WIN.y + WIN.h / 2, merge);
    const project = (u: number, v: number, z: number): Point => [cx + (u * Math.cos(theta) - v * Math.sin(theta)), cy + (u * Math.sin(theta) + v * Math.cos(theta)) * tilt - z];

    // Shadow on the floor under the whole stack.
    c.save(); c.translate(cx, cy + 60 * (1 - flat)); c.transform(Math.cos(theta), Math.sin(theta) * tilt, -Math.sin(theta), Math.cos(theta) * tilt, 0, 0);
    shadowed(c, 90, 0, .55 * explode, () => fillBox(c, -size.w / 2, -size.h / 2, size.w, size.h, 12, rgb(BLACK, .5))); c.restore();

    for (let i = 0; i < 5; i++) {
      const z = elevation(i), grow = outCubic(prog(f, q.explode + i * 1.5, q.explode + 8 + i * 1.5));
      if (grow <= 0) continue;
      const named = outCubic(prog(f, q.callouts[i], q.callouts[i] + 8));
      c.save(); c.translate(cx, cy - z); c.transform(Math.cos(theta), Math.sin(theta) * tilt, -Math.sin(theta), Math.cos(theta) * tilt, 0, 0);
      c.scale(lerp(.7, 1, grow), lerp(.7, 1, grow)); c.globalAlpha *= grow;
      const sx = size.w / ART.w, sy = size.h / ART.h;
      fillBox(c, -size.w / 2, -size.h / 2, size.w, size.h, 6, rgb(mix(D.surfaceAlt, accent[i], .06 + .1 * named)));
      strokeBox(c, -size.w / 2, -size.h / 2, size.w, size.h, 6, rgb(mix(D.inkMuted, accent[i], named), .5 + .4 * named), 2.5);
      if (flat < 1) { c.save(); c.scale(sx, sy); c.globalAlpha *= (1 - flat) * lit; art[i](c, accent[i]); c.restore(); }
      if (i === 4 && page > 0) {
        // The top plate becomes the published page.
        c.save(); c.beginPath(); c.roundRect(-size.w / 2, -size.h / 2, size.w, size.h, 6); c.clip(); c.globalAlpha *= page;
        c.imageSmoothingQuality = 'high'; c.drawImage(site, -size.w / 2, -size.h / 2, size.w, size.h); c.restore();
      }
      c.restore();

      // Callout: a leader from the plate's corner to its name.
      const gone = prog(f, q.compress[0] - 5, q.compress[0] - 2);
      if (named > 0 && gone < 1) {
        const [ax, ay] = project(PW / 2 - 24, -PH / 2 + 24, z), lx = L.label;
        const a = 1 - gone;
        disc(c, ax, ay, 7 * named, rgb(accent[i], a));
        line(c, ax, ay, lerp(ax, lx - 18, named), ay, rgb(accent[i], .8 * a), 2.5);
        text(c, LABELS[i], lx + (1 - named) * 26, ay + 14, {family: 'Bricolage', weight: 800, size: 42, tracking: -.8, color: rgb(D.ink, named * a)});
      }
    }
    // A ring leaves the page when the stack lands.
    const landed = prog(f, q.merge + 12, q.merge + 40);
    if (landed > 0 && landed < 1) strokeBox(c, WIN.x - 90 * landed, WIN.y - 90 * landed, WIN.w + 180 * landed, WIN.h + 180 * landed, 16 + 60 * landed, rgb(D.primary, SOFT * (1 - landed)), 5 * (1 - landed));
    c.restore();

    c.globalAlpha = 1 - prog(f, end - 8, end - 2);
    // The second pair of lines arrives with the build, so each holds for two seconds or more.
    const swap = q.compress[0] - 6;
    const [one, two] = L.lines, note = L.note;
    word(c, 'Every part.', one.x, one.y, one.size, D.ink, f, q.explode + 2, swap);
    word(c, 'One site.', two.x, two.y, two.size, D.primary, f, q.callouts[2], swap);
    // A soft ring marks each closing gap.
    for (const cue of q.compress) { const wave = prog(f, cue, cue + 14); if (wave > 0 && wave < 1) { c.save(); c.translate(CX, CY + L.ring.dy); c.scale(1, .5); c.beginPath(); c.arc(0, 0, L.ring.r0 + L.ring.dr * outCubic(wave), 0, Math.PI * 2); c.strokeStyle = rgb(D.primary, SOFT * (1 - wave)); c.lineWidth = 8 * (1 - wave); c.stroke(); c.restore(); } }
    word(c, 'Your team', one.x, one.y, one.size, D.ink, f, q.compress[0] + 2);
    word(c, 'runs it.', two.x, two.y, two.size, D.ink, f, q.compress[0] + 5);
    phrase(c, 'No code to touch.', note.x, note.y, {size: note.size, color: D.primary}, f, q.compress[2]);
    sample(c, p.copy.sample, D.inkMuted, 1);
    c.globalAlpha = 1;
  }};
}
