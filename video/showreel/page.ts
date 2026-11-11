// An illustrated event page, drawn once for each style and mode: 1920 by 1080
// for the landscape cut, and a phone layout of 1080 by 1220 for the vertical cut.
// Colours, heading faces and corner shapes come from the product's presets.
import {type C, type Format, type Project, type Style, type Palette, W, H, rgb, mix, text, wrap, fillBox, strokeBox, line, disc, quadPoints, trace} from './kit.ts';

/** Size of the page picture in each format, in page pixels, and whether it is the phone layout. */
export const LAYOUT: Record<Format, {w: number; h: number; phone: boolean}> = {
  landscape: {w: 1920, h: 1080, phone: false},
  vertical: {w: 1080, h: 1220, phone: true},
};

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

/**
 * The same event page laid out for a phone. The order is the same: masthead,
 * rule, headline, then when and where under it, subtitle, the two buttons and
 * the schedule. The schedule runs off the bottom, as a real page does.
 */
export function drawMobilePage(c: C, p: Project, style: Style, mode: 'light' | 'dark') {
  const {w: PW, h: PH} = LAYOUT.vertical, X0 = 60, X1 = PW - 60;
  const P: Palette = style[mode], e = p.experience, r = style.radius === 'sharp' ? 0 : 4;
  const heading = {family: style.font, weight: style.weight};
  const hair = rgb(mix(P.surface, P.ink, .22)), upper = style.id === 'zine';
  c.fillStyle = rgb(P.surface); c.fillRect(0, 0, PW, PH);

  if (style.id === 'atlas') {
    // Map graticule.
    for (let x = 60; x < PW; x += 120) line(c, x, 0, x, PH, rgb(P.accent, .12), 1);
    for (let y = 60; y < PH; y += 120) line(c, 0, y, PW, y, rgb(P.accent, .12), 1);
  }
  // Masthead: the event name, and the menu a phone layout folds its links into.
  text(c, upper ? e.name.toUpperCase() : e.name, X0, 96, {...heading, size: 44, color: rgb(P.ink)});
  text(c, upper ? 'MENU' : 'Menu', X1, 94, {size: 36, weight: 600, align: 'right', color: rgb(P.inkMuted)});
  if (style.id === 'broadsheet') { line(c, X0, 138, X1, 138, rgb(P.ink), 4); line(c, X0, 147, X1, 147, rgb(P.ink), 1.5); }
  else if (style.id === 'newsroom') line(c, 0, 140, PW, 140, rgb(P.primary), 6);
  else if (style.id === 'zine') line(c, X0, 140, X1, 140, rgb(P.ink), 8);
  else line(c, X0, 140, X1, 140, hair, 2);

  // Hero. The headline comes first; when and where follow it as a plain line.
  const size = style.id === 'broadsheet' ? 94 : style.id === 'zine' ? 90 : 84;
  const title = upper ? e.headline.toUpperCase() : e.headline;
  const lines = wrap(c, title, X1 - X0, {...heading, size}), top = 200 + size * .9;
  lines.forEach((value, i) => text(c, value, X0 - 4, top + i * size * 1.06, {...heading, size, tracking: -size * .012, color: rgb(P.ink)}));
  const below = top + (lines.length - 1) * size * 1.06;
  text(c, `${e.dates} · ${e.venue}`, X0, below + 80, {size: 36, weight: 600, color: rgb(P.primary)});
  const about = wrap(c, e.subtitle, X1 - X0, {size: 36, weight: 400});
  about.forEach((value, i) => text(c, value, X0, below + 146 + i * 50, {size: 36, weight: 400, color: rgb(P.inkMuted)}));
  const by = below + 146 + (about.length - 1) * 50 + 54;
  // Buttons and type are a little larger than on the landscape page: the window shows this page at 0.89.
  fillBox(c, X0, by, 260, 84, r, rgb(P.primary));
  text(c, 'Register', X0 + 130, by + 44, {size: 36, weight: 700, align: 'center', baseline: 'middle', color: rgb(P.surface)});
  strokeBox(c, X0 + 284, by, 330, 84, r, rgb(P.ink), 2.5);
  text(c, 'View schedule', X0 + 449, by + 44, {size: 36, weight: 700, align: 'center', baseline: 'middle', color: rgb(P.ink)});

  if (style.id === 'zine') {
    // Cut-and-paste sticker at the preset's callout angle.
    c.save(); c.translate(X0 + 805, by + 42); c.rotate(-2.5 * Math.PI / 180);
    fillBox(c, -120, -40, 240, 80, 0, rgb(P.primary));
    text(c, `${p.copy.days} DAYS`, 0, 4, {...heading, size: 44, align: 'center', baseline: 'middle', color: rgb(P.surface)}); c.restore();
  }
  if (style.id === 'field-guide') {
    // A sprig, in the manner of the botanical line drawings, beside the buttons.
    c.save(); c.translate(X1 - 110, by + 76); c.scale(.72, .72);
    const stem = quadPoints([0, 0], [50, -90], [15, -194]);
    c.lineCap = 'round'; trace(c, stem, 0, 1, rgb(P.primary), 3 / .72);
    for (let i = 1; i <= 5; i++) {
      const [x, y] = stem[i * 4], side = i % 2 ? 1 : -1;
      c.save(); c.translate(x, y); c.rotate(side * .9 - .3);
      c.beginPath(); c.ellipse(side * 22, 0, 24, 9, 0, 0, Math.PI * 2); c.strokeStyle = rgb(P.primary); c.lineWidth = 2.5 / .72; c.stroke(); c.restore();
    }
    c.restore();
  }

  // Programme panel, full width under the hero. It runs off the bottom of the page.
  const px = X0, pw = X1 - X0, py = by + 140, ph = PH - py + 40;
  if (style.id === 'broadsheet') line(c, px, py - 30, px + pw, py - 30, hair, 1.5); else fillBox(c, px, py, pw, ph, r, rgb(P.surfaceAlt));
  if (style.id === 'zine') strokeBox(c, px, py, pw, ph, 0, rgb(P.ink), 4);
  text(c, upper ? 'SCHEDULE' : 'Schedule', px + 40, py + 74, {...heading, size: 46, color: rgb(P.ink)});
  line(c, px + 40, py + 104, px + pw - 40, py + 104, style.id === 'newsroom' ? rgb(P.primary) : rgb(P.ink), style.id === 'zine' ? 5 : 2.5);
  e.sessions.forEach((s, i) => {
    const y = py + 130 + i * 150;
    if (y > PH) return;
    if (style.id === 'atlas') {
      disc(c, px + 66, y + 44, 26, rgb(i % 2 ? P.accent : P.primary));
      text(c, i % 2 ? 'B' : 'A', px + 66, y + 46, {...heading, size: 28, align: 'center', baseline: 'middle', color: rgb(P.surface)});
    }
    const left = px + (style.id === 'atlas' ? 112 : 40);
    text(c, `${s.time} – ${s.end}`, left, y + 40, {family: 'Mono', weight: 500, size: 36, color: rgb(P.primary)});
    text(c, wrap(c, s.title, pw - (left - px) - 40, {size: 38, weight: 700})[0], left, y + 88, {size: 38, weight: 700, color: rgb(P.ink)});
    line(c, px + 40, y + 124, px + pw - 40, y + 124, hair, 2);
  });
}

/** All twelve pages of the format, cached. Index is style * 2 + (dark ? 1 : 0). */
export function pages(p: Project) {
  const size = LAYOUT[p.format], draw = size.phone ? drawMobilePage : drawPage;
  return p.styles.flatMap(style => (['light', 'dark'] as const).map(mode => {
    const el = document.createElement('canvas'); el.width = size.w; el.height = size.h;
    draw(el.getContext('2d', {alpha: false})!, p, style, mode);
    return el;
  }));
}
