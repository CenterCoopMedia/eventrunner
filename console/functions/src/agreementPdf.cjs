'use strict';

/**
 * The signer's PDF copy of the agreement they accepted: the Event Runner
 * mark, the agreement title and version, who accepted it and when, the full
 * text exactly as stored, and a closing record with the text's SHA-256.
 *
 * The text is drawn, never rewritten: paragraphs and line breaks stay where
 * the stored body has them. Standard PDF fonts cover Windows-1252 only, so a
 * character outside it is drawn as its closest Latin letter, or as "?". The
 * fingerprint on the last page is the hash of the stored text, not of this
 * drawing of it.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

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

// The four-stroke Event Runner mark on its tile (console/web/public/favicon.svg), in a 24-unit box.
const TILE_PATH = 'M4 0H20A4 4 0 0 1 24 4V20A4 4 0 0 1 20 24H4A4 4 0 0 1 0 20V4A4 4 0 0 1 4 0Z';
const MARK_PATH = 'M5.35 5H7.45V19H5.35Z M7.45 5H18.65V7.1H7.45Z M7.45 11.3H14.1V12.7H7.45Z M7.45 17.25H16.55V19H7.45Z';

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

/** Text the font can draw: each character kept, reduced to its base letter, or replaced with "?". */
function drawable(font, text) {
  const value = String(text ?? '');
  const fits = (s) => {
    try {
      font.encodeText(s);
      return true;
    } catch {
      return false;
    }
  };
  if (fits(value)) return value;
  let out = '';
  for (const ch of value) {
    if (fits(ch)) out += ch;
    else {
      const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      out += base && fits(base) ? base : '?';
    }
  }
  return out;
}

const glyphWidths = new WeakMap();

/**
 * The drawn width of `text`. pdf-lib's widthOfTextAtSize subtracts kerning
 * for the standard fonts, but drawText does not apply it, so this adds up
 * each character's own width instead.
 */
function widthOf(font, size, text) {
  let widths = glyphWidths.get(font);
  if (!widths) {
    widths = new Map();
    glyphWidths.set(font, widths);
  }
  let total = 0;
  for (const ch of text) {
    let width = widths.get(ch);
    if (width === undefined) {
      width = font.widthOfTextAtSize(ch, 1000);
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
function wrap(font, size, text, width) {
  const measure = (s) => widthOf(font, size, s);
  const maxChars = Math.ceil(width / (size * 0.15)) + 1;
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
      // No glyph is narrower than 0.15 em, so no line holds more than `maxChars` characters.
      while (rest.length > maxChars || measure(rest) > width) {
        const cut = longestFit(measure, rest, width, maxChars);
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
  page.drawSvgPath(MARK_PATH, { x, y: top, scale, color: color('onAccent') });
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
  const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const [typedName, legalName, signerTitle, organizationName, eventName] = ['typedName', 'legalName', 'signerTitle', 'organizationName', 'eventName'].map((key) => oneLine(copy[key]));
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
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
    page.drawText(drawable(font, value), { x, y: yAt, size, font, color: color(tone) });
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
  ].map(([label, value]) => ({ label, lines: wrap(bold, 10.5, value, columnWidth) }));
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
    if (!stored.trim()) {
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
  const redrawn = [title, body, typedName, legalName, signerTitle, organizationName, eventName].some((value) => drawable(regular, flat(value)) !== flat(value));
  const note = [
    'This fingerprint is computed from the agreement title and text as stored. Any change to either gives a different fingerprint.',
    redrawn ? 'Some characters in the stored text or the names above are outside this PDF\'s font and are shown as their closest letter or as "?".' : '',
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

module.exports = { agreementPdf, formatAcceptedAt };
