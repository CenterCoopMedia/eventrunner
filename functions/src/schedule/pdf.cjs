'use strict';

/**
 * buildSchedulePdf — config-driven schedule PDF (spec §9 "Schedule PDF",
 * issue #27).
 *
 * The reference implementation (`buildSchedulePdf` /
 * `generateSchedulePDF`, `functions/index.js:13521`) hardcoded the event
 * title, dates, venue text, a fixed two-bucket day structure, and literal
 * colors. This port makes every one of those config-driven:
 *
 *   - header/branding text from `config/event` (name, tagline, venue)
 *   - colors from `config/theme.colors` (spec §7.6 allowlist: this file may
 *     hold hex literals because pdf-lib needs numeric RGB, but the VALUES
 *     below are fallbacks only — a configured theme always wins)
 *   - day grouping from `config/event.days[]`, arbitrary length (not the
 *     fixed two-bucket structure) — an event with 1 day or 7 days groups
 *     the same way
 *   - `fitText` binary search ports as-is: given a width-measuring
 *     function, find the largest font size (bounded above and below) whose
 *     rendered width still fits, same contract as the reference
 *     implementation's per-block font measurement
 *
 * Layout is one page per configured day (continuation pages when a day's
 * sessions overflow one page), each session printed as time range, room,
 * title (size-fit to the column width), then speaker names when resolved.
 *
 * Library choice: `pdf-lib` — pure JS, no native deps (no libcairo/canvas
 * toolchain to keep working across every client's Cloud Functions runtime),
 * synchronous-enough standard-font metrics (no network fetch), and a
 * document builder that fitText's binary search plugs into directly via
 * `PDFFont.widthOfTextAtSize`. No spec line names a library, so this is a
 * new judgment call, not a port of the reference's dependency.
 */

const { speakerDisplayName, isPubliclyVisibleSpeaker } = require('shared/speaker');

const DEFAULT_COLORS = Object.freeze({
  // Fallback palette (spec §7.6 allowlist path) — used only for the fields
  // a configured `config/theme.colors` doc omits. A fully-configured theme
  // never reaches these.
  primary: '#1F2933',
  ink: '#1F2933',
  inkMuted: '#52606D',
  surface: '#FFFFFF',
  accent: '#3E7CB1',
});

const PAGE_SIZE = [612, 792]; // US Letter, points (pdf-lib default unit)
const MARGIN = 48;
const HEADER_HEIGHT = 96;
const ROW_MIN_HEIGHT = 26;
const ROW_GAP = 6;

// ------------------------------------------------------------------ pure

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Hex color string ("#rgb" or "#rrggbb") to 0-1 RGB floats for pdf-lib's
 * `rgb()`. Returns null on anything that is not a valid hex color — callers
 * fall back to a default rather than crash a whole PDF generation over one
 * bad config value.
 *
 * @param {*} hex
 * @returns {{ r: number, g: number, b: number } | null}
 */
function hexToRgb01(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/**
 * Resolve the theme colors this document needs, each falling back to
 * {@link DEFAULT_COLORS} independently when the configured value is
 * missing or not a valid hex color.
 *
 * @param {{ colors?: Record<string, string> } | null | undefined} theme
 * @returns {Record<keyof typeof DEFAULT_COLORS, { r: number, g: number, b: number }>}
 */
function resolveThemeColors(theme) {
  const colors = theme && typeof theme === 'object' ? theme.colors : null;
  const out = {};
  for (const key of Object.keys(DEFAULT_COLORS)) {
    const configured = colors && typeof colors === 'object' ? colors[key] : undefined;
    out[key] = hexToRgb01(configured) || hexToRgb01(DEFAULT_COLORS[key]);
  }
  return out;
}

/**
 * Resolve the header/branding text this document needs from `config/event`.
 * Every field fails soft to a placeholder string rather than throwing or
 * printing "undefined" — a half-seeded config/event must still produce a
 * readable (if sparse) PDF.
 *
 * @param {object | null | undefined} event
 * @returns {{ name: string, tagline: string | null, venueLine: string | null }}
 */
function resolveBranding(event) {
  const name = isNonEmptyString(event?.name) ? event.name.trim() : 'Event schedule';
  const tagline = isNonEmptyString(event?.tagline) ? event.tagline.trim() : null;
  const venue = event?.venue;
  let venueLine = null;
  if (venue && typeof venue === 'object') {
    const parts = [venue.name, venue.city, venue.region].filter(isNonEmptyString);
    venueLine = parts.length > 0 ? parts.join(', ') : null;
  }
  return { name, tagline, venueLine };
}

/**
 * `fitText` binary search (spec §9, ported as-is): the largest integer font
 * size in `[minSize, maxSize]` whose rendered width (per `measure`) is
 * still `<= maxWidth`. Falls back to `minSize` when even the smallest size
 * overflows — callers accept the overflow rather than lose the size floor
 * (a 0pt label is worse than a slightly clipped one).
 *
 * @param {{ measure: (text: string, size: number) => number, text: string,
 *           maxWidth: number, maxSize: number, minSize?: number }} args
 * @returns {{ size: number, width: number }}
 */
function fitText({ measure, text, maxWidth, maxSize, minSize = 6 }) {
  if (!isNonEmptyString(text)) return { size: maxSize, width: 0 };
  if (!(maxSize >= minSize)) return { size: minSize, width: measure(text, minSize) };

  let lo = minSize;
  let hi = maxSize;
  let best = minSize;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const w = measure(text, mid);
    if (w <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { size: best, width: measure(text, best) };
}

/**
 * Group sessions by `config/event.days[]`, in configured day order,
 * arbitrary length (spec §9: replaces the reference implementation's fixed
 * two-bucket structure). Sessions naming a `dayId` not present in `days`
 * are dropped — an orphaned session is a data problem the PDF cannot
 * resolve, not something to misfile under a guessed day. Within a day,
 * sessions sort by `startTime` then `order`.
 *
 * @param {Array<object>} sessions
 * @param {Array<{ id: string }>} days
 * @returns {Array<{ day: object, sessions: object[] }>}
 */
function groupSessionsByDay(sessions, days) {
  const safeDays = Array.isArray(days) ? days : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const byDayId = new Map(safeDays.map((d) => [d.id, []]));
  for (const session of safeSessions) {
    if (!session || !byDayId.has(session.dayId)) continue;
    byDayId.get(session.dayId).push(session);
  }
  return safeDays.map((day) => ({
    day,
    sessions: (byDayId.get(day.id) || []).slice().sort((a, b) => {
      const at = typeof a.startTime === 'string' ? a.startTime : '';
      const bt = typeof b.startTime === 'string' ? b.startTime : '';
      if (at !== bt) return at < bt ? -1 : 1;
      return (a.order ?? 0) - (b.order ?? 0);
    }),
  }));
}

/**
 * Resolve a session's speaker names from a lookup map, best effort. Missing
 * ids (no speaker directory populated yet, or a stale id) are silently
 * dropped rather than printing a placeholder — a schedule PDF with no
 * speaker line for a session is normal; a "[unknown speaker]" line is not.
 *
 * @param {string[] | undefined} speakerIds
 * @param {Record<string, string>} namesById
 * @returns {string}
 */
function resolveSpeakerLine(speakerIds, namesById) {
  if (!Array.isArray(speakerIds)) return '';
  return speakerIds
    .map((id) => namesById[id])
    .filter(isNonEmptyString)
    .join(', ');
}

// The one speaker status this file will resolve a public display name for.
/**
 * Derive a speaker's public display name from the canonical `speakers/{id}`
 * record (spec §4.3).
 *
 * Both halves come from `shared/speaker`, which the speaker tranche (#20)
 * made the single definition of this vocabulary — the local copies this
 * replaced were written against that then-unmerged branch and carried a
 * note to consolidate once both landed. `isPubliclyVisibleSpeaker` owns
 * which statuses publish and `speakerDisplayName` owns the name join, so
 * the printed schedule cannot disagree with the public directory about
 * either.
 *
 * Only a publishable speaker's name is ever resolved; every other status —
 * invited, accepted, and the soft-delete 'removed' tombstone — resolves to
 * '' and is dropped by {@link resolveSpeakerLine}'s isNonEmptyString
 * filter, exactly like an id with no matching document. Never a
 * placeholder.
 *
 * `displayName` is still preferred when a record carries one. The canonical
 * document does not store it — it is derived, and lives only on the
 * `speakers_public` projection — but honouring it costs nothing and keeps
 * this correct if it is ever handed a projection document.
 *
 * @param {{ firstName?: string, lastName?: string, displayName?: string,
 *           status?: string } | null | undefined} record
 * @returns {string}
 */
function deriveApprovedSpeakerName(record) {
  if (!record || typeof record !== 'object') return '';
  if (!isPubliclyVisibleSpeaker(record)) return '';
  if (isNonEmptyString(record.displayName)) return record.displayName.trim();
  return speakerDisplayName(record);
}

/** "09:30" -> "9:30 AM" display, 24h wall-clock in, 12h out. Malformed input passes through unchanged. */
function formatClock(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm || '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Session time range display, e.g. "9:30–10:00 AM". */
function formatSessionTime(session) {
  const start = formatClock(session?.startTime);
  const end = formatClock(session?.endTime);
  if (!start) return '';
  if (!end) return start;
  return `${start}–${end}`;
}

// Strips Unicode combining diacritical marks (U+0300-U+036F) left behind by
// an NFKD decomposition — e.g. "é" -> "e" + U+0301, this removes the U+0301.
const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

/**
 * Whether `font` (a pdf-lib StandardFonts font, WinAnsi-encoded) can render
 * `text` without throwing. `widthOfTextAtSize` validates encodability the
 * same way `drawText` does, so this is a safe probe with no side effect.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 * @returns {boolean}
 */
function canEncode(font, text) {
  try {
    font.widthOfTextAtSize(text, 12);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort sanitize free-text config/session/speaker content for a
 * WinAnsi-only standard font (Helvetica/HelveticaBold) before it is drawn.
 *
 * pdf-lib's standard fonts throw ("WinAnsi cannot encode ...") the instant
 * `drawText`/`widthOfTextAtSize` sees a character outside Windows-1252 —
 * which is most of Unicode: CJK, Arabic, Cyrillic, emoji, and Latin
 * characters beyond Latin-1 (e.g. Vietnamese, Turkish "ğ"). Left unhandled,
 * one event name or speaker name in any of those scripts 500s the whole
 * public endpoint.
 *
 * Tradeoff, chosen over embedding a Unicode font: a broad-coverage face
 * (e.g. Noto Sans + a CJK companion) that actually covers CJK/Arabic runs
 * several megabytes even subsetted to common ranges, which is a real cost
 * on every cold start of a Cloud Function whose only other dependency is
 * pdf-lib itself (functions ship no other font today, and fontkit's
 * subsetting still has to walk the full glyph table at embed time). This
 * sanitize step keeps the function's footprint unchanged and NEVER 500s;
 * the readable cost is that a CJK/Arabic-only title renders as the bracketed
 * fallback below, not its own script. If a client's schedule regularly needs
 * non-Latin display text, embedding a subset Unicode font via
 * `@pdf-lib/fontkit` is the follow-up — noted here rather than done
 * speculatively for zero configured deployments that need it yet.
 *
 * Per Unicode code point (not UTF-16 code unit, so a surrogate-pair emoji is
 * never split into two invalid lone surrogates):
 *   1. Encodable as-is (the common case: plain ASCII/Latin-1) -> kept.
 *   2. Not encodable, but NFKD-decomposing it and stripping combining marks
 *      yields an encodable base letter (accented Latin beyond Latin-1,
 *      e.g. "ế" -> "e") -> the transliterated form is kept.
 *   3. Still not encodable (CJK, Arabic, Cyrillic, emoji, ...) -> dropped.
 * If every character in a non-empty input drops, the whole string becomes
 * a bracketed placeholder rather than silently rendering blank.
 *
 * @param {import('pdf-lib').PDFFont} font
 * @param {*} text
 * @returns {string}
 */
function sanitizeForFont(font, text) {
  if (typeof text !== 'string' || text === '') return '';
  if (canEncode(font, text)) return text; // fast path: no scan needed at all

  let out = '';
  for (const ch of text) {
    if (canEncode(font, ch)) {
      out += ch;
      continue;
    }
    const transliterated = ch.normalize('NFKD').replace(COMBINING_MARKS_RE, '');
    if (transliterated && transliterated !== ch && canEncode(font, transliterated)) {
      out += transliterated;
    }
    // else: unrecoverable in this font — dropped, not replaced per-character
    // (a run of "???" is worse than a shorter, still-readable string).
  }
  return out.trim() ? out : '(unsupported characters)';
}

// -------------------------------------------------------------- pdf build

/**
 * Build the schedule PDF. Pure with respect to the outside world beyond
 * pdf-lib itself — no Firestore, no network — so it is directly unit
 * testable against fixture config/sessions.
 *
 * @param {{ event: object | null, theme: object | null,
 *           sessions: Array<object>, speakerNamesById?: Record<string, string> }} args
 * @returns {Promise<Uint8Array>}
 */
async function buildSchedulePdf({ event, theme, sessions, speakerNamesById = {} }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  const colors = resolveThemeColors(theme);
  const branding = resolveBranding(event);
  const days = Array.isArray(event?.days) ? event.days : [];
  const grouped = groupSessionsByDay(sessions, days);

  const doc = await PDFDocument.create();
  doc.setTitle(branding.name);
  doc.setSubject(branding.tagline || 'Event schedule');
  doc.setProducer('run-of-show');
  doc.setCreator('run-of-show');

  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const toColor = (c) => rgb(c.r, c.g, c.b);
  const contentWidth = PAGE_SIZE[0] - MARGIN * 2;

  // Every piece of free-text config/session/speaker content is sanitized
  // through its actual drawing font before `drawText`/`fitText` ever see it
  // (spec §9, non-WinAnsi text otherwise 500s the whole endpoint — see
  // sanitizeForFont's doc comment for the tradeoff).
  const safeBody = (text) => sanitizeForFont(bodyFont, text);
  const safeBold = (text) => sanitizeForFont(boldFont, text);

  /** Draw the shared header band; returns the y coordinate to start content at. */
  function drawHeader(page, dayLabel) {
    const [width, height] = [PAGE_SIZE[0], PAGE_SIZE[1]];
    page.drawRectangle({
      x: 0,
      y: height - HEADER_HEIGHT,
      width,
      height: HEADER_HEIGHT,
      color: toColor(colors.primary),
    });
    page.drawText(safeBold(branding.name), {
      x: MARGIN,
      y: height - 40,
      size: 20,
      font: boldFont,
      color: toColor(colors.surface),
    });
    const sub = [branding.tagline, branding.venueLine].filter(isNonEmptyString).join(' · ');
    if (sub) {
      page.drawText(safeBody(sub), {
        x: MARGIN,
        y: height - 62,
        size: 10,
        font: bodyFont,
        color: toColor(colors.surface),
      });
    }
    if (dayLabel) {
      page.drawText(safeBold(dayLabel), {
        x: MARGIN,
        y: height - 82,
        size: 12,
        font: boldFont,
        color: toColor(colors.accent),
      });
    }
    return height - HEADER_HEIGHT - 24;
  }

  function newPage(dayLabel) {
    const page = doc.addPage(PAGE_SIZE);
    return { page, y: drawHeader(page, dayLabel) };
  }

  const dayLabelOf = (day) => (isNonEmptyString(day?.label) ? day.label : day?.date || day?.id || '');

  if (grouped.length === 0) {
    // No configured days at all — still emit a valid single-page PDF with
    // just the header/branding rather than a zero-page document.
    newPage(null);
  }

  for (const { day, sessions: daySessions } of grouped) {
    let { page, y } = newPage(dayLabelOf(day));

    if (daySessions.length === 0) {
      page.drawText('No sessions scheduled.', {
        x: MARGIN,
        y: y - 14,
        size: 11,
        font: bodyFont,
        color: toColor(colors.inkMuted),
      });
      continue;
    }

    for (const session of daySessions) {
      if (y < MARGIN + ROW_MIN_HEIGHT) {
        ({ page, y } = newPage(`${dayLabelOf(day)} (cont.)`));
      }

      const timeText = formatSessionTime(session); // digits/AM/PM/en-dash only — always WinAnsi-safe
      const locationText = safeBody(
        isNonEmptyString(session?.location) ? session.location : '',
      );
      const titleText = safeBold(
        isNonEmptyString(session?.title) ? session.title : 'Untitled session',
      );
      const speakerText = safeBody(resolveSpeakerLine(session?.speakerIds, speakerNamesById));

      const timeColWidth = 90;
      const locationColWidth = 110;
      const titleColX = MARGIN + timeColWidth + locationColWidth;
      const titleColWidth = contentWidth - timeColWidth - locationColWidth;

      page.drawText(timeText, {
        x: MARGIN,
        y,
        size: 10,
        font: bodyFont,
        color: toColor(colors.inkMuted),
      });
      if (locationText) {
        page.drawText(locationText, {
          x: MARGIN + timeColWidth,
          y,
          size: 10,
          font: bodyFont,
          color: toColor(colors.inkMuted),
        });
      }

      const fit = fitText({
        measure: (t, size) => boldFont.widthOfTextAtSize(t, size),
        text: titleText,
        maxWidth: titleColWidth,
        maxSize: 12,
        minSize: 8,
      });
      page.drawText(titleText, {
        x: titleColX,
        y,
        size: fit.size,
        font: boldFont,
        color: toColor(colors.ink),
      });

      let rowHeight = ROW_MIN_HEIGHT;
      if (speakerText) {
        page.drawText(speakerText, {
          x: titleColX,
          y: y - 13,
          size: 9,
          font: bodyFont,
          color: toColor(colors.inkMuted),
        });
        rowHeight += 13;
      }

      y -= rowHeight + ROW_GAP;
    }
  }

  return doc.save();
}

// -------------------------------------------------------------------- http

const { methodNotAllowed, notFound, internal } = require('../core/errors.cjs');

/**
 * @param {{ db: FirebaseFirestore.Firestore, getConfig: () => Promise<object>,
 *           log?: Pick<Console, 'error'> }} deps
 */
function createBuildSchedulePdfHandler({ db, getConfig, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    const config = await getConfig();
    if (config?.features?.schedulePdf !== true) {
      return notFound(res, 'The schedule PDF is not enabled for this event.');
    }

    try {
      const [sessionsSnap, speakersSnap] = await Promise.all([
        db.collection('cmsSchedule').where('visible', '==', true).get(),
        // Best-effort: no speaker directory is populated in every
        // deployment yet (the speaker tranche, PR #74, is a parallel branch
        // not yet merged here) — an empty or missing collection just means
        // no speaker line is printed. deriveApprovedSpeakerName further
        // requires status === 'approved', so an invited-but-not-yet-approved
        // speaker record is silently skipped the same way.
        db.collection('speakers').get().catch(() => ({ docs: [] })),
      ]);
      const sessions = sessionsSnap.docs.map((d) => d.data());
      const speakerNamesById = {};
      for (const d of speakersSnap.docs) {
        const name = deriveApprovedSpeakerName(d.data());
        if (name) speakerNamesById[d.id] = name;
      }

      const bytes = await buildSchedulePdf({
        event: config.event,
        theme: config.theme,
        sessions,
        speakerNamesById,
      });

      res.status(200);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="schedule.pdf"');
      res.send(Buffer.from(bytes));
    } catch (err) {
      log.error('buildSchedulePdf failed', err);
      internal(res, 'The schedule PDF could not be generated.');
    }
  };
}

/** Deployable export: buildSchedulePdf (public GET, spec §9). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['GET'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    buildSchedulePdf: onRequest({ region }, withCors(async (req, res) => {
      await createBuildSchedulePdfHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  buildSchedulePdf,
  createBuildSchedulePdfHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    DEFAULT_COLORS,
    hexToRgb01,
    resolveThemeColors,
    resolveBranding,
    fitText,
    groupSessionsByDay,
    resolveSpeakerLine,
    deriveApprovedSpeakerName,
    formatClock,
    formatSessionTime,
    canEncode,
    sanitizeForFont,
  },
};
