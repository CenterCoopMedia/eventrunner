// Montage. Panels light up on the beat until eight fill the frame, then they
// fold into one point. Panels appear where they stay: on a fast cut list
// that is what keeps bright areas from flashing.
import {type C, type Project, type RGB, type Point, W, H, prog, outCubic, inCubic, outExpo, lerp, rgb, text, fillBox, strokeBox, disc, ring, shadowed, quadPoints, along, trace} from './kit.ts';
import {type Scene, ground, SOFT} from './shared.ts';

const PW = 440, PH = 400, GAP = 32, X0 = 32, Y0 = 124;
const NAMES = ['Pages', 'Schedule', 'Speakers', 'Tickets', 'Check-in', 'Email', 'Sponsors', 'Styles'];

export function montage(p: Project): Scene {
  const q = p.clock.cues.montage, D = p.brand.dark, [start, end] = [p.clock.scenes[5].start, p.clock.scenes[5].end];
  // Style and palette colour for each panel: six hues from the presets, no two neighbours alike.
  const LOOK: [number, 'primary' | 'accent' | 'highlight' | 'ink'][] = [[0, 'primary'], [4, 'primary'], [3, 'primary'], [5, 'primary'], [2, 'highlight'], [4, 'accent'], [3, 'accent'], [0, 'ink']];
  const center = (i: number): Point => [X0 + (i % 4) * (PW + GAP) + PW / 2, Y0 + Math.floor(i / 4) * (PH + GAP) + PH / 2];
  // The last two panels share the seventh beat; the eighth beat starts the fold.
  const born = (i: number) => (i === 7 ? q.panels[6] + 4 : q.panels[i]), fold = q.panels[7];
  const grow = (t: number, delay: number, length = 8) => outCubic(prog(t, delay, delay + length));

  // One small animation per panel, drawn in a 200 by 150 box, t in frames.
  const art: ((c: C, t: number, ink: RGB, fill: RGB) => void)[] = [
    (c, t, ink) => { [[0, 96, 200, 54], [0, 30, 96, 58], [104, 30, 96, 58], [0, 0, 200, 22]].forEach(([x, y, w, h], i) => { const s = grow(t, i * 2); fillBox(c, x, y, w * s, h, 8, rgb(ink, i === 3 ? 1 : .8)); }); },
    (c, t, ink) => { for (let i = 0; i < 4; i++) { const s = outExpo(prog(t, i * 2, i * 2 + 9)); fillBox(c, 0, i * 40, 44 * grow(t, i * 2, 4), 26, 6, rgb(ink)); fillBox(c, 56, i * 40 + 4, (144 - (i % 2) * 40) * s, 18, 9, rgb(ink, .75)); } },
    (c, t, ink) => { for (let i = 0; i < 3; i++) { const s = grow(t, i * 2.5, 6); disc(c, 34 + i * 66, 60, 30 * s, rgb(ink)); fillBox(c, 8 + i * 66, 112, 52 * s, 12, 6, rgb(ink, .7)); } },
    (c, t, ink, fill) => {
      const s = grow(t, 0, 7); c.save(); c.translate(100, 70); c.rotate(-.12); c.scale(lerp(.7, 1, s), lerp(.7, 1, s)); c.globalAlpha *= s;
      fillBox(c, -100, -52, 200, 104, 14, rgb(ink));
      // Perforation and notches are cut in the panel's own colour.
      for (let k = 0; k < 4; k++) disc(c, 46, -30 + k * 20, 4.5, rgb(fill));
      disc(c, 46, -52, 12, rgb(fill)); disc(c, 46, 52, 12, rgb(fill)); c.restore();
    },
    (c, t, ink, fill) => { const s = grow(t, 0, 6); disc(c, 100, 72, 68 * s, rgb(ink)); c.lineCap = 'round'; c.lineJoin = 'round'; trace(c, [[68, 74], [92, 98], [134, 50]], 0, outCubic(prog(t, 4, 11)), rgb(fill), 13); },
    (c, t, ink) => {
      const path = quadPoints([-30, 140], [70, -50], [190, 44]), k = outCubic(prog(t, 0, 13)), [x, y] = along(path, k), [nx, ny] = along(path, Math.min(1, k + .03));
      c.lineCap = 'round'; c.setLineDash([10, 12]); trace(c, path, 0, k, rgb(ink, .7), 5); c.setLineDash([]);
      c.save(); c.translate(x, y); c.rotate(Math.atan2(ny - y, nx - x)); c.beginPath(); c.moveTo(40, 0); c.lineTo(-34, -30); c.lineTo(-14, 0); c.lineTo(-34, 30); c.closePath(); c.fillStyle = rgb(ink); c.fill(); c.restore();
    },
    (c, t, ink) => { for (let i = 0; i < 4; i++) { const s = grow(t, i * 2, 6); c.save(); c.translate(48 + (i % 2) * 104, 36 + Math.floor(i / 2) * 78); c.globalAlpha *= s; c.scale(lerp(.8, 1, s), lerp(.8, 1, s)); strokeBox(c, -44, -30, 88, 60, 10, rgb(ink), 6); fillBox(c, -24, -8, 48, 16, 8, rgb(ink, .8)); c.restore(); } },
    (c, t) => { p.styles.forEach((style, i) => { const s = grow(t, i * 1.4, 6); disc(c, 34 + (i % 3) * 66, 38 + Math.floor(i / 3) * 70, 28 * s, rgb(style.dark.surface)); disc(c, 34 + (i % 3) * 66, 38 + Math.floor(i / 3) * 70, 17 * s, rgb(style.dark.primary)); }); },
  ];

  function panel(c: C, i: number, f: number) {
    const at = born(i);
    if (f < at) return;
    const style = p.styles[LOOK[i][0]], fill = style.dark[LOOK[i][1]], ink = style.dark.surface;
    // On in three frames, at full size from the fourth: bright edges barely move.
    const on = prog(f, at, at + 3), settle = outCubic(prog(f, at, at + 5)), away = inCubic(prog(f, fold + 1 + i * .2, q.implode));
    const [x, y] = center(i), s = lerp(.94, 1, settle) * (1 - away);
    c.save(); c.translate(lerp(x, W / 2, away), lerp(y, H / 2, away)); c.rotate(away * (i % 2 ? 1.2 : -1.2)); c.scale(s, s); c.globalAlpha = on;
    shadowed(c, 60, 26, .5, () => fillBox(c, -PW / 2, -PH / 2, PW, PH, 22, rgb(fill)));
    text(c, `0${i + 1}`, -PW / 2 + 28, -PH / 2 + 50, {family: 'Mono', weight: 500, size: 21, tracking: 2, color: rgb(ink)});
    // The name is uncovered from the left; it does not slide.
    const label = style.id === 'zine' ? NAMES[i].toUpperCase() : NAMES[i];
    c.save(); c.beginPath(); c.rect(-PW / 2, PH / 2 - 120, PW * outCubic(prog(f, at + 2, at + 10)), 110); c.clip();
    text(c, label, -PW / 2 + 26, PH / 2 - 36, {family: style.font, weight: style.weight, size: 66, tracking: -1, color: rgb(ink)}); c.restore();
    c.save(); c.translate(PW / 2 - 270, -PH / 2 + 36); c.scale(1.2, 1.2); art[i](c, f - at - 2, ink, fill); c.restore();
    c.restore();
    const wave = prog(f, at, at + 14);
    if (wave > 0 && wave < 1) ring(c, x, y, 190 + 260 * outExpo(wave), rgb(fill, SOFT * (1 - wave)), 6 * (1 - wave));
  }

  return {from: start, to: end, draw(c: C, f: number) {
    // The ground glow lifts a little on each beat, by less than the flash
    // screen's threshold; the panels themselves stay put.
    let beat = 0;
    for (const cue of q.panels.slice(0, 7)) beat = Math.max(beat, 1 - prog(f, cue, cue + 12));
    ground(c, D, W / 2, H / 2, 1, [W / 2, H / 2], 1 + .5 * beat);
    for (let i = 0; i < 8; i++) panel(c, i, f);
    // After the fold, one point of light waits through the silence.
    const dot = prog(f, q.implode - 2, q.implode);
    if (dot > 0) disc(c, W / 2, H / 2, 9 * dot, rgb(D.ink));
  }};
}
