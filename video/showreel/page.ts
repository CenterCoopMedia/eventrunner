// An illustrated event page, 1920 by 1080, drawn once for each style and mode.
// Colours, heading faces and corner shapes come from the product's presets.
import {type C, type Project, type Style, type Palette, W, H, rgb, mix, text, wrap, fillBox, strokeBox, line, disc, quadPoints, trace} from './kit.ts';

export function drawPage(c: C, p: Project, style: Style, mode: 'light' | 'dark') {
  const P: Palette = style[mode], e = p.experience, r = style.radius === 'sharp' ? 0 : 4;
  const heading = {family: style.font, weight: style.weight};
  const hair = rgb(mix(P.surface, P.ink, .22)), upper = style.id === 'zine';
  c.fillStyle = rgb(P.surface); c.fillRect(0, 0, W, H);

  if (style.id === 'atlas') {
    // Map graticule.
    for (let x = 60; x < W; x += 120) line(c, x, 0, x, H, rgb(P.accent, .12), 1);
    for (let y = 60; y < H; y += 120) line(c, 0, y, W, y, rgb(P.accent, .12), 1);
  }
  // Masthead.
  text(c, upper ? e.name.toUpperCase() : e.name, 120, 78, {...heading, size: 40, color: rgb(P.ink)});
  ['Schedule', 'Speakers', 'Sponsors'].forEach((item, i) => text(c, item, 1130 + i * 160, 76, {size: 27, weight: 600, color: rgb(P.inkMuted)}));
  fillBox(c, 1620, 38, 180, 60, r, rgb(P.primary));
  text(c, 'Register', 1710, 69, {size: 27, weight: 700, align: 'center', baseline: 'middle', color: rgb(P.surface)});
  if (style.id === 'broadsheet') { line(c, 120, 126, 1800, 126, rgb(P.ink), 4); line(c, 120, 135, 1800, 135, rgb(P.ink), 1.5); }
  else if (style.id === 'newsroom') line(c, 0, 128, W, 128, rgb(P.primary), 6);
  else if (style.id === 'zine') line(c, 120, 128, 1800, 128, rgb(P.ink), 8);
  else line(c, 120, 128, 1800, 128, hair, 2);

  // Hero.
  // The headline comes first. When and where follow it as a plain line, not as a label above it.
  const size = style.id === 'broadsheet' ? 132 : style.id === 'zine' ? 128 : 112;
  const title = upper ? e.headline.toUpperCase() : e.headline;
  const lines = wrap(c, title, 1000, {...heading, size});
  lines.forEach((value, i) => text(c, value, 116, 330 + i * size * 1.06, {...heading, size, tracking: -size * .012, color: rgb(P.ink)}));
  const below = 330 + (lines.length - 1) * size * 1.06;
  text(c, `${e.dates} · ${e.venue}`, 120, below + 86, {size: 36, weight: 600, color: rgb(P.primary)});
  wrap(c, e.subtitle, 900, {size: 36, weight: 400}).forEach((value, i) => text(c, value, 120, below + 152 + i * 50, {size: 36, weight: 400, color: rgb(P.inkMuted)}));
  fillBox(c, 120, below + 274, 236, 76, r, rgb(P.primary));
  text(c, 'Register', 238, below + 314, {size: 30, weight: 700, align: 'center', baseline: 'middle', color: rgb(P.surface)});
  strokeBox(c, 380, below + 274, 280, 76, r, rgb(P.ink), 2.5);
  text(c, 'View schedule', 520, below + 314, {size: 30, weight: 700, align: 'center', baseline: 'middle', color: rgb(P.ink)});

  if (style.id === 'zine') {
    // Cut-and-paste sticker at the preset's callout angle.
    c.save(); c.translate(880, below + 312); c.rotate(-2.5 * Math.PI / 180);
    fillBox(c, -120, -40, 240, 80, 0, rgb(P.primary));
    text(c, `${p.copy.days} DAYS`, 0, 4, {...heading, size: 44, align: 'center', baseline: 'middle', color: rgb(P.surface)}); c.restore();
  }
  if (style.id === 'field-guide') {
    // A sprig, in the manner of the botanical line drawings.
    const stem = quadPoints([1085, below + 350], [1135, below + 260], [1100, below + 156]);
    c.lineCap = 'round'; trace(c, stem, 0, 1, rgb(P.primary), 3);
    for (let i = 1; i <= 5; i++) {
      const [x, y] = stem[i * 4], side = i % 2 ? 1 : -1;
      c.save(); c.translate(x, y); c.rotate(side * .9 - .3);
      c.beginPath(); c.ellipse(side * 22, 0, 24, 9, 0, 0, Math.PI * 2); c.strokeStyle = rgb(P.primary); c.lineWidth = 2.5; c.stroke(); c.restore();
    }
  }

  // Programme panel.
  const px = 1200, pw = 600, py = 200, ph = 700;
  if (style.id === 'broadsheet') line(c, px - 40, py, px - 40, py + ph, hair, 1.5); else fillBox(c, px, py, pw, ph, r, rgb(P.surfaceAlt));
  if (style.id === 'zine') strokeBox(c, px, py, pw, ph, 0, rgb(P.ink), 4);
  text(c, upper ? 'SCHEDULE' : 'Schedule', px + 40, py + 74, {...heading, size: 46, color: rgb(P.ink)});
  line(c, px + 40, py + 104, px + pw - 40, py + 104, style.id === 'newsroom' ? rgb(P.primary) : rgb(P.ink), style.id === 'zine' ? 5 : 2.5);
  e.sessions.slice(0, 3).forEach((s, i) => {
    const y = py + 130 + i * 186;
    if (style.id === 'atlas') {
      disc(c, px + 66, y + 44, 26, rgb(i % 2 ? P.accent : P.primary));
      text(c, i % 2 ? 'B' : 'A', px + 66, y + 46, {...heading, size: 28, align: 'center', baseline: 'middle', color: rgb(P.surface)});
    }
    const left = px + (style.id === 'atlas' ? 112 : 40);
    text(c, `${s.time} – ${s.end}`, left, y + 40, {family: 'Mono', weight: 500, size: 25, color: rgb(P.primary)});
    wrap(c, s.title, pw - (left - px) - 40, {size: 31, weight: 700}).slice(0, 2).forEach((value, k) => text(c, value, left, y + 84 + k * 38, {size: 31, weight: 700, color: rgb(P.ink)}));
    if (i < 2) line(c, px + 40, y + 164, px + pw - 40, y + 164, hair, 2);
  });
}

/** All twelve pages, cached. Index is style * 2 + (dark ? 1 : 0). */
export function pages(p: Project) {
  return p.styles.flatMap(style => (['light', 'dark'] as const).map(mode => {
    const el = document.createElement('canvas'); el.width = W; el.height = H;
    drawPage(el.getContext('2d', {alpha: false})!, p, style, mode);
    return el;
  }));
}
