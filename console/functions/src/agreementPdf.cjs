'use strict';

/**
 * The signer's PDF copy of the agreement they accepted: the Event Runner
 * mark, the agreement title and version, who accepted it and when, the full
 * text exactly as stored, and a closing record with the text's SHA-256.
 *
 * The text is drawn, never rewritten: paragraphs and line breaks stay where
 * the stored body has them. The type is Noto Sans (Latin, Greek, Cyrillic),
 * with DejaVu Sans for the symbols Noto Sans lacks, such as "≤" and arrows;
 * both are subset copies in console/functions/fonts. A character neither
 * font has, such as a Chinese name, is written as its code point, "[U+674E]",
 * never as a look-alike or "?". The fingerprint on the last page is the hash
 * of the stored text, not of this drawing of it.
 */

const fs = require('node:fs');
const path = require('node:path');
const fontkit = require('@pdf-lib/fontkit');
const { PDFDocument, StandardFonts, LineCapStyle, rgb } = require('pdf-lib');

const PAGE = [612, 792]; // US Letter, in points
const MARGIN_X = 64;
const TOP = 792 - 56;
const BOTTOM = 72;
const WIDTH = PAGE[0] - MARGIN_X * 2;

// The console's light brand tokens (console/web/src/styles.css), as 0-255 RGB.
const COLORS = Object.freeze({
  accent: [26, 82, 150],
  ink: [23, 24, 26],
  muted: [80, 83, 89],
  rule: [218, 218, 218],
  panel: [240, 240, 239],
  onAccent: [250, 250, 249],
});
const color = (name) => rgb(...COLORS[name].map((v) => v / 255));

// Badger's face on the accent tile, in the favicon's 24-unit box.
// Face paths match design/brand/badger-face.svg; draw them at 75% inside the tile.
const TILE_PATH = 'M4 0H20A4 4 0 0 1 24 4V20A4 4 0 0 1 20 24H4A4 4 0 0 1 0 20V4A4 4 0 0 1 4 0Z';
const BADGE_PATH = 'M7 4.5H17A4 4 0 0 1 21 8.5V18.5A4 4 0 0 1 17 22.5H7A4 4 0 0 1 3 18.5V8.5A4 4 0 0 1 7 4.5Z';
const BAND_PATH = 'M4 8.5A3 3 0 0 1 7 5.5H17A3 3 0 0 1 20 8.5V10H4Z';
const MARK_PATH = 'M10.2 1H13.8A1.2 1.2 0 0 1 15 2.2V5.3A1.2 1.2 0 0 1 13.8 6.5H10.2A1.2 1.2 0 0 1 9 5.3V2.2A1.2 1.2 0 0 1 10.2 1Z M10.15 13.75A1.65 1.65 0 1 1 6.85 13.75A1.65 1.65 0 1 1 10.15 13.75Z M17.15 13.75A1.65 1.65 0 1 1 13.85 13.75A1.65 1.65 0 1 1 17.15 13.75Z';
const SMILE_PATH = 'M8.5 18.25Q12 21.25 15.5 18.25';

const BODY_SIZE = 10.5;
const BODY_LEADING = 15.5;
const PARAGRAPH_GAP = 8;

/** The time of acceptance in Eastern time, for people to read: "November 5, 2026 at 3:00 PM EST". */
function formatAcceptedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date).replace(/[\u202f\u00a0]/g, ' ');
}

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const fontBytes = new Map();
const readFont = (file) => {
  if (!fontBytes.has(file)) fontBytes.set(file, fs.readFileSync(path.join(FONT_DIR, file)));
  return fontBytes.get(file);
};

const characterSets = new Map();
const characterSet = (file) => {
  if (!characterSets.has(file)) {
    // A code point the cmap sends to glyph 0 (such as the U+FFFF sentinel) draws the missing-glyph box.
    const font = fontkit.create(readFont(file));
    characterSets.set(file, new Set(font.characterSet.filter((cp) => font.glyphForCodePoint(cp).id !== 0)));
  }
  return characterSets.get(file);
};

/**
 * The faces this PDF draws with. A face is a list of fonts, tried in order
 * for each character; a fallback font is embedded only when `texts` has a
 * character that it alone covers. The files in fonts/ are already subset,
 * and they are embedded whole: fontkit's subsetter drops DejaVu Sans glyphs
 * that are drawn in separate calls.
 */
async function embedFaces(doc, texts) {
  doc.registerFontkit(fontkit);
  const codePoints = new Set(Array.from(texts.join(''), (ch) => ch.codePointAt(0)));
  const face = async (files) => {
    const fonts = [];
    for (const file of files) {
      const has = characterSet(file);
      const needed = !fonts.length || [...codePoints].some((cp) => has.has(cp) && !fonts.some((entry) => entry.has.has(cp)));
      if (needed) fonts.push({ font: await doc.embedFont(readFont(file)), has });
    }
    return fonts;
  };
  return {
    regular: await face(['NotoSans-Regular.ttf', 'DejaVuSans.ttf']),
    bold: await face(['NotoSans-Bold.ttf', 'DejaVuSans-Bold.ttf']),
    // Courier draws the fingerprint, which is hex; any printable ASCII is safe in it.
    mono: [{ font: await doc.embedFont(StandardFonts.Courier), has: new Set(Array.from({ length: 95 }, (_, i) => i + 0x20)) }],
  };
}

// Characters with no visible form of their own: controls, format characters
// such as joiners and the soft hyphen, line and paragraph separators, and
// unassigned or private code points. fontkit draws some of them as spaces,
// so they are written as code points instead.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]/u;
const fontFor = (face, ch) => (INVISIBLE.test(ch) ? undefined : face.find((entry) => entry.has.has(ch.codePointAt(0))));

/**
 * `text` as this face can draw it: every character as stored, except one no
 * font in the face has, which is written as its code point. A run of them
 * shares one bracket: "李明" is "[U+674E U+660E]".
 */
function drawable(face, text) {
  let out = '';
  let missing = [];
  const flush = () => {
    if (missing.length) out += `[${missing.join(' ')}]`;
    missing = [];
  };
  for (const ch of String(text ?? '')) {
    if (fontFor(face, ch)) {
      flush();
      out += ch;
    } else {
      missing.push(`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
  flush();
  return out;
}

/** `text` (already drawable) cut into runs that each use one font of the face. */
function runs(face, text) {
  const out = [];
  for (const ch of text) {
    const { font } = fontFor(face, ch);
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += ch;
    else out.push({ font, text: ch });
  }
  return out;
}

const glyphWidths = new WeakMap();

/**
 * The drawn width of drawable `text`: each character's own width in the
 * font that draws it. The fonts carry no kerning, and pdf-lib's width for
 * the standard fonts subtracts kerning that drawText does not apply, so
 * adding up single characters is what drawText draws.
 */
function widthOf(face, size, text) {
  let widths = glyphWidths.get(face);
  if (!widths) {
    widths = new Map();
    glyphWidths.set(face, widths);
  }
  let total = 0;
  for (const ch of text) {
    let width = widths.get(ch);
    if (width === undefined) {
      width = fontFor(face, ch).font.widthOfTextAtSize(ch, 1000);
      widths.set(ch, width);
    }
    total += width;
  }
  return (total * size) / 1000;
}

/**
 * The longest start of `text` that fits `width`, by binary search over at
 * most `cap` characters, so a very long word costs one short search per line.
 * At least one character.
 */
function longestFit(measure, text, width, cap = text.length) {
  let lo = 1;
  let hi = Math.min(text.length, cap);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid)) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Lines of `text` that fit `width`. Line breaks, indentation and repeated
 * spaces are kept; a line breaks at a space, and a word too long for a line
 * is split.
 */
const MIN_ADVANCE = 0.1; // em: the hair space, the narrowest glyph in fonts/ with a width

function wrap(font, size, text, width) {
  const measure = (s) => widthOf(font, size, s);
  const maxChars = Math.ceil(width / (size * MIN_ADVANCE)) + 1;
  const lines = [];
  for (const part of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const token of drawable(font, part.replace(/\t/g, '    ')).split(/( +)/)) {
      if (!token) continue;
      if (line.length + token.length <= maxChars && measure(line + token) <= width) {
        line += token;
        continue;
      }
      // Indentation stays with the word that follows it.
      let rest = token;
      if (line.trim()) {
        lines.push(line.trimEnd());
        if (token.startsWith(' ')) {
          line = ''; // the break replaces the space
          continue;
        }
      } else {
        rest = line + token;
      }
      line = '';
      // No glyph that moves the pen is narrower than MIN_ADVANCE, so `maxChars` bounds the search.
      while (rest.length > maxChars || measure(rest) > width) {
        let cut = longestFit(measure, rest, width, maxChars);
        // Combining marks take no width: they stay on the line with their letter.
        while (cut < rest.length && /\p{M}/u.test(rest[cut]) && measure(rest[cut]) === 0) cut += 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** `text` cut with an ellipsis to fit `width`. */
function truncate(font, size, text, width) {
  const measure = (s) => widthOf(font, size, s);
  const value = drawable(font, text);
  if (measure(value) <= width) return value;
  return `${value.slice(0, longestFit(measure, value, width - measure('…'))).trimEnd()}…`;
}

function drawMark(page, x, top, size) {
  const scale = size / 24;
  page.drawSvgPath(TILE_PATH, { x, y: top, scale, color: color('accent') });
  const face = { x: x + size / 8, y: top - size / 8, scale: scale * 0.75 };
  page.drawSvgPath(BADGE_PATH, { ...face, color: color('accent'), borderColor: color('onAccent'), borderWidth: 2 });
  page.drawSvgPath(BAND_PATH, { ...face, color: color('onAccent'), opacity: 0.45 });
  page.drawSvgPath(MARK_PATH, { ...face, color: color('onAccent') });
  page.drawSvgPath(SMILE_PATH, { ...face, borderColor: color('onAccent'), borderWidth: 2, borderLineCap: LineCapStyle.Round });
}

/**
 * @param {{ title: string, version: number|string, body: string, sha256: string,
 *   typedName: string, legalName: string, signerTitle: string,
 *   organizationName: string, eventName: string, acceptedAt: string }} copy
 * @returns {Promise<Uint8Array>}
 */
async function agreementPdf(copy) {
  const { title, version, body, sha256, acceptedAt } = copy;
  // Names and the event are one line each, so the panels they fill stay inside a page.
  const oneLine = (value) => String(value ?? '').replace(/[\r\n\t\v\f\u2028\u2029]+/g, ' ').replace(/^ +| +$/g, '');
  const [typedName, legalName, signerTitle, organizationName, eventName] = ['typedName', 'legalName', 'signerTitle', 'organizationName', 'eventName'].map((key) => oneLine(copy[key]));
  const doc = await PDFDocument.create();
  const { regular, bold, mono } = await embedFaces(doc, [title, body, typedName, legalName, signerTitle, organizationName, eventName, String(version), String(acceptedAt)]);
  const at = new Date(acceptedAt);
  doc.setTitle(`${title}, version ${version}`);
  doc.setSubject(`Accepted by ${typedName} for ${legalName}`);
  doc.setAuthor('Event Runner');
  doc.setCreator('Event Runner');
  doc.setProducer('Event Runner');
  if (!Number.isNaN(at.getTime())) {
    doc.setCreationDate(at);
    doc.setModificationDate(at);
  }

  const when = formatAcceptedAt(acceptedAt);
  const signer = `${typedName}, ${signerTitle}`;
  const organization = legalName === organizationName ? legalName : `${legalName} (${organizationName})`;

  let page;
  let y;
  const text = (value, { x = MARGIN_X, size = BODY_SIZE, font = regular, tone = 'ink', at: yAt = y } = {}) => {
    let left = x;
    for (const run of runs(font, drawable(font, value))) {
      page.drawText(run.text, { x: left, y: yAt, size, font: run.font, color: color(tone) });
      left += widthOf(font, size, run.text);
    }
  };
  const newPage = () => {
    page = doc.addPage(PAGE);
    drawMark(page, MARGIN_X, TOP + 4, 16);
    text('Event Runner', { x: MARGIN_X + 22, at: TOP - 8, size: 9.5, font: bold });
    const label = truncate(regular, 8.5, title, WIDTH - 160);
    text(label, { x: PAGE[0] - MARGIN_X - widthOf(regular, 8.5, label), at: TOP - 8, size: 8.5, tone: 'muted' });
    page.drawLine({ start: { x: MARGIN_X, y: TOP - 22 }, end: { x: PAGE[0] - MARGIN_X, y: TOP - 22 }, thickness: 0.6, color: color('rule') });
    y = TOP - 52;
  };
  const room = (height) => {
    if (y - height < BOTTOM) newPage();
  };

  // First page: a larger masthead in place of the running header.
  page = doc.addPage(PAGE);
  drawMark(page, MARGIN_X, TOP + 6, 30);
  text('Event Runner', { x: MARGIN_X + 40, at: TOP - 15, size: 17, font: bold });
  const kicker = 'Agreement copy';
  text(kicker, { x: PAGE[0] - MARGIN_X - widthOf(regular, 9, kicker), at: TOP - 13, size: 9, tone: 'muted' });
  page.drawRectangle({ x: MARGIN_X, y: TOP - 38, width: WIDTH, height: 2, color: color('accent') });
  y = TOP - 84;

  for (const line of wrap(bold, 22, title, WIDTH)) {
    room(28);
    text(line, { size: 22, font: bold });
    y -= 28;
  }
  text(`Version ${version}  ·  Accepted ${when}`, { size: 10, tone: 'muted', at: y + 6 });
  y -= 26;

  // The summary panel: who, for whom, for what, and when.
  const columnWidth = (WIDTH - 32 - 24) / 2;
  const cells = [
    ['Accepted by', signer],
    ['On behalf of', organization],
    ['Event', eventName],
    ['Accepted on', when],
  ].map(([label, value]) => {
    // At most four lines a cell, so the panel fits on a page; the record below has each value in full.
    const lines = wrap(bold, 10.5, value, columnWidth);
    if (lines.length > 4) lines.splice(3, Infinity, truncate(bold, 10.5, `${lines.slice(3).join('')}…`, columnWidth));
    return { label, lines };
  });
  const rows = [cells.slice(0, 2), cells.slice(2)];
  const rowHeights = rows.map((row) => 26 + Math.max(...row.map((c) => c.lines.length)) * 14);
  const panelHeight = 20 + rowHeights.reduce((a, b) => a + b, 0) - 6;
  room(panelHeight);
  page.drawRectangle({ x: MARGIN_X, y: y - panelHeight, width: WIDTH, height: panelHeight, color: color('panel') });
  page.drawRectangle({ x: MARGIN_X, y: y - panelHeight, width: 3, height: panelHeight, color: color('accent') });
  let rowTop = y - 22;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const x = MARGIN_X + 16 + c * (columnWidth + 24);
      text(cell.label.toUpperCase(), { x, at: rowTop, size: 7.5, font: bold, tone: 'muted' });
      cell.lines.forEach((line, i) => text(line, { x, at: rowTop - 15 - i * 14, size: 10.5, font: bold }));
    });
    rowTop -= rowHeights[r];
  });
  y -= panelHeight + 34;

  // The agreement text, line by line as stored: a blank line is a paragraph gap.
  let paragraphStart = true;
  for (const stored of body.split(/\r?\n/)) {
    if (/^[ \t]*$/.test(stored)) {
      y -= PARAGRAPH_GAP;
      paragraphStart = true;
      continue;
    }
    const lines = wrap(regular, BODY_SIZE, stored, WIDTH);
    lines.forEach((line, i) => {
      // Never leave a paragraph's first line alone at the foot of a page.
      room(paragraphStart && i === 0 ? BODY_LEADING * 2 : BODY_LEADING);
      if (line) text(line);
      y -= BODY_LEADING;
    });
    paragraphStart = false;
  }
  y -= PARAGRAPH_GAP;

  // The closing record.
  const record = [
    ['Accepted by', signer],
    ['On behalf of', organization],
    ['Event', eventName],
    ['Accepted on', when],
    ['Recorded (UTC)', acceptedAt],
    ['Agreement', `${title}, version ${version}`],
  ];
  const labelWidth = 92;
  const recordLines = record.map(([label, value]) => ({ label, lines: wrap(regular, 9.5, value, WIDTH - labelWidth - 32) }));
  const shaLines = wrap(mono, 8.5, sha256, WIDTH - 32);
  const flat = (value) => value.replace(/\r?\n|\t/g, ' ');
  const redrawn = [title, body, typedName, legalName, signerTitle, organizationName, eventName]
    .some((value) => [regular, bold].some((face) => drawable(face, flat(value)) !== flat(value)));
  const note = [
    'This fingerprint is computed from the agreement title and text as stored. Any change to either gives a different fingerprint.',
    redrawn ? 'Characters that this PDF\'s fonts cannot show are written as their Unicode code points in brackets, such as [U+674E].' : '',
  ].filter(Boolean).join(' ');
  const noteLines = wrap(regular, 8, note, WIDTH - 32);
  const recordHeight = 44 + recordLines.reduce((n, r) => n + r.lines.length * 14, 0) + 20 + shaLines.length * 11 + 8 + noteLines.length * 11 + 14;
  y -= 10;
  // Boxed when it fits on one page; otherwise it flows on, row by row, without the box.
  const boxed = recordHeight <= TOP - 52 - BOTTOM;
  room(boxed ? recordHeight : 80);
  if (boxed) page.drawRectangle({ x: MARGIN_X, y: y - recordHeight, width: WIDTH, height: recordHeight, borderColor: color('rule'), borderWidth: 0.8 });
  page.drawRectangle({ x: MARGIN_X, y: y - 3, width: WIDTH, height: 3, color: color('accent') });
  y -= 24;
  text('Acceptance record', { x: MARGIN_X + 16, size: 11, font: bold, tone: 'accent' });
  y -= 20;
  for (const { label, lines } of recordLines) {
    lines.forEach((line, i) => {
      room(14);
      if (i === 0) text(label, { x: MARGIN_X + 16, size: 8.5, font: bold, tone: 'muted' });
      text(line, { x: MARGIN_X + 16 + labelWidth, size: 9.5 });
      y -= 14;
    });
  }
  y -= 6;
  room(25);
  text('Text fingerprint (SHA-256)', { x: MARGIN_X + 16, size: 8.5, font: bold, tone: 'muted' });
  y -= 14;
  shaLines.forEach((line) => {
    room(11);
    text(line, { x: MARGIN_X + 16, size: 8.5, font: mono });
    y -= 11;
  });
  y -= 4;
  noteLines.forEach((line) => {
    room(11);
    text(line, { x: MARGIN_X + 16, size: 8, tone: 'muted' });
    y -= 11;
  });

  // Footers, once the page count is known.
  const pages = doc.getPages();
  const footer = `${title}  ·  Version ${version}  ·  Accepted by ${typedName}`;
  pages.forEach((each, i) => {
    page = each;
    each.drawLine({ start: { x: MARGIN_X, y: 50 }, end: { x: PAGE[0] - MARGIN_X, y: 50 }, thickness: 0.6, color: color('rule') });
    const number = `Page ${i + 1} of ${pages.length}`;
    text(truncate(regular, 7.5, footer, WIDTH - widthOf(regular, 7.5, number) - 24), { at: 36, size: 7.5, tone: 'muted' });
    text(number, { x: PAGE[0] - MARGIN_X - widthOf(regular, 7.5, number), at: 36, size: 7.5, tone: 'muted' });
  });

  return doc.save();
}

module.exports = { agreementPdf, formatAcceptedAt, internals: { drawable, embedFaces } };
