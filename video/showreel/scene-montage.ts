// Montage. The film began with speed lines that became the rules of a schedule.
// Here the whole product is one run sheet: eight ruled bands, lit from the top
// on the beat, then folded into a point. Bands appear where they stay; on a
// fast cut list that is what keeps bright areas from flashing.
import {type C, type Project, type RGB, W, H, prog, outCubic, inCubic, outExpo, lerp, rgb, text, fillBox, strokeBox, disc, quadPoints, along, trace} from './kit.ts';
import {type Scene, ground, PARTS} from './shared.ts';

export function montage(p: Project): Scene {
  const q = p.clock.cues.montage, D = p.brand.dark, [start, end] = [p.clock.scenes[5].start, p.clock.scenes[5].end];
  const BAND = H / PARTS.length;
  // The last two bands share the seventh beat; the eighth beat starts the fold.
  const born = (i: number) => (i === 7 ? q.panels[6] + 4 : q.panels[i]), fold = q.panels[7];
  const grow = (t: number, delay: number, length = 8) => outCubic(prog(t, delay, delay + length));

  // One small drawing for each part, in a 200 by 150 box, t in frames.
  const art: ((c: C, t: number, ink: RGB, fill: RGB) => void)[] = [
    (c, t, ink) => { [[0, 96, 200, 54], [0, 30, 96, 58], [104, 30, 96, 58], [0, 0, 200, 22]].forEach(([x, y, w, h], i) => { const s = grow(t, i * 2); fillBox(c, x, y, w * s, h, 4, rgb(ink, i === 3 ? 1 : .8)); }); },
    (c, t, ink) => { for (let i = 0; i < 4; i++) { const s = outExpo(prog(t, i * 2, i * 2 + 9)); fillBox(c, 0, i * 40, 44 * grow(t, i * 2, 4), 26, 4, rgb(ink)); fillBox(c, 56, i * 40 + 4, (144 - (i % 2) * 40) * s, 18, 4, rgb(ink, .75)); } },
    (c, t, ink) => { for (let i = 0; i < 3; i++) { const s = grow(t, i * 2.5, 6); disc(c, 34 + i * 66, 60, 30 * s, rgb(ink)); fillBox(c, 8 + i * 66, 112, 52 * s, 12, 4, rgb(ink, .7)); } },
    (c, t, ink, fill) => {
      const s = grow(t, 0, 7); c.save(); c.translate(100, 75); c.rotate(-.12); c.scale(lerp(.7, 1, s), lerp(.7, 1, s)); c.globalAlpha *= s;
      fillBox(c, -100, -52, 200, 104, 8, rgb(ink));
      // Perforation and notches are cut in the band's own colour.
      for (let k = 0; k < 4; k++) disc(c, 46, -30 + k * 20, 4.5, rgb(fill));
      disc(c, 46, -52, 12, rgb(fill)); disc(c, 46, 52, 12, rgb(fill)); c.restore();
    },
    (c, t, ink, fill) => { const s = grow(t, 0, 6); disc(c, 100, 75, 68 * s, rgb(ink)); c.lineCap = 'round'; c.lineJoin = 'round'; trace(c, [[68, 77], [92, 101], [134, 53]], 0, outCubic(prog(t, 4, 11)), rgb(fill), 13); },
    (c, t, ink) => {
      const path = quadPoints([-30, 140], [70, -50], [190, 44]), k = outCubic(prog(t, 0, 13)), [x, y] = along(path, k), [nx, ny] = along(path, Math.min(1, k + .03));
      c.lineCap = 'round'; c.setLineDash([10, 12]); trace(c, path, 0, k, rgb(ink, .7), 5); c.setLineDash([]);
      c.save(); c.translate(x, y); c.rotate(Math.atan2(ny - y, nx - x)); c.beginPath(); c.moveTo(40, 0); c.lineTo(-34, -30); c.lineTo(-14, 0); c.lineTo(-34, 30); c.closePath(); c.fillStyle = rgb(ink); c.fill(); c.restore();
    },
    (c, t, ink) => { for (let i = 0; i < 4; i++) { const s = grow(t, i * 2, 6); c.save(); c.translate(48 + (i % 2) * 104, 36 + Math.floor(i / 2) * 78); c.globalAlpha *= s; c.scale(lerp(.8, 1, s), lerp(.8, 1, s)); strokeBox(c, -44, -30, 88, 60, 4, rgb(ink), 6); fillBox(c, -24, -8, 48, 16, 4, rgb(ink, .8)); c.restore(); } },
    (c, t) => { p.styles.forEach((style, i) => { const s = grow(t, i * 1.4, 6); disc(c, 34 + (i % 3) * 66, 38 + Math.floor(i / 3) * 70, 28 * s, rgb(style.dark.surface)); disc(c, 34 + (i % 3) * 66, 38 + Math.floor(i / 3) * 70, 17 * s, rgb(style.dark.primary)); }); },
  ];

  function band(c: C, i: number, f: number) {
    const at = born(i);
    if (f < at) return;
    const [name, styleIndex, key] = PARTS[i], style = p.styles[styleIndex], fill = style.dark[key], ink = style.dark.surface;
    // The band is uncovered from the left in five frames and does not move again until the fold.
    const open = outCubic(prog(f, at, at + 5)), away = inCubic(prog(f, fold + 1 + i * .2, q.implode));
    const y = lerp(i * BAND, H / 2, away), h = BAND * (1 - away);
    if (h <= 0) return;
    c.save(); c.beginPath(); c.rect(0, y, W * open, h + .5); c.clip();
    c.fillStyle = rgb(fill); c.fillRect(0, y, W, h + .5);
    c.translate(0, y + h / 2); c.scale(1, h / BAND);
    const label = style.id === 'zine' ? name.toUpperCase() : name;
    c.save(); c.beginPath(); c.rect(0, -BAND / 2, W * outCubic(prog(f, at + 2, at + 10)), BAND); c.clip();
    text(c, label, 120, BAND * .2, {family: style.font, weight: style.weight, size: BAND * .62, tracking: -1, color: rgb(ink)}); c.restore();
    const scale = (BAND - 28) / 150;
    c.translate(W - 120 - 200 * scale, -75 * scale); c.scale(scale, scale); art[i](c, f - at - 2, ink, fill);
    c.restore();
  }

  return {from: start, to: end, draw(c: C, f: number) {
    ground(c, D);
    for (let i = 0; i < PARTS.length; i++) band(c, i, f);
    // After the fold, one point of light waits through the silence.
    const dot = prog(f, q.implode - 2, q.implode);
    if (dot > 0) disc(c, W / 2, H / 2, 9 * dot, rgb(D.ink));
  }};
}
