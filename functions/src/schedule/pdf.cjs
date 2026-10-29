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
 *   - colors from `config/theme.colors` (the fallback palette and the hex
 *     parsing live in `../pdf/kit.cjs`, which is on the spec §7.6 hex
 *     allowlist; a configured theme always wins)
 *   - day grouping from `config/event.days[]`, arbitrary length (not the
 *     fixed two-bucket structure) — an event with 1 day or 7 days groups
 *     the same way
 *   - `fitText` binary search ports as-is (now in `../pdf/kit.cjs`): given
 *     a width-measuring function, find the largest font size (bounded above
 *     and below) whose rendered width still fits, same contract as the
 *     reference implementation's per-block font measurement
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
// The theme, branding, fitText and font-safety helpers are shared with the
// invoice PDF (#209), so they live in one module both documents import.
const {
  DEFAULT_COLORS,
  isNonEmptyString,
  hexToRgb01,
  resolveThemeColors,
  resolveBranding,
  fitText,
  canEncode,
  sanitizeForFont,
} = require('../pdf/kit.cjs');

const PAGE_SIZE = [612, 792]; // US Letter, points (pdf-lib default unit)
const MARGIN = 48;
const HEADER_HEIGHT = 96;
const ROW_MIN_HEIGHT = 26;
const ROW_GAP = 6;

// ------------------------------------------------------------------ pure

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

// -------------------------------------------------------------- pdf build

/**
 * Build the schedule PDF. Pure with respect to the outside world beyond
 * pdf-lib itself — no Firestore, no network — so it is directly unit
 * testable against fixture config/sessions.
 *
 * ONE GENERATOR, TWO DOCUMENTS. The public programme passes no owner; the
 * personal path passes `ownerName` (whose name the header carries) and
 * `onlySessionIds` (the caller's own bookmark filter). An `ownerName` with
 * no `onlySessionIds` would mislabel the public programme as somebody's
 * personal copy, so the pair is enforced here rather than trusted to the
 * callers.
 *
 * @param {{ event: object | null, theme: object | null,
 *           sessions: Array<object>, speakerNamesById?: Record<string, string>,
 *           ownerName?: string | null, onlySessionIds?: string[] | null }} args
 * @returns {Promise<Uint8Array>}
 */
async function buildSchedulePdf({
  event,
  theme,
  sessions,
  speakerNamesById = {},
  ownerName = null,
  onlySessionIds = null,
}) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

  if (ownerName && !Array.isArray(onlySessionIds)) {
    throw new Error('buildSchedulePdf: an owner without a bookmark filter would mislabel the public programme.');
  }

  const colors = resolveThemeColors(theme);
  const branding = resolveBranding(event);
  const days = Array.isArray(event?.days) ? event.days : [];
  // A filter, even an empty one, IS the filter: an attendee with zero
  // bookmarks gets an empty personal programme, never the public one.
  let sourceSessions;
  if (Array.isArray(onlySessionIds)) {
    const wanted = new Set(onlySessionIds);
    sourceSessions = (Array.isArray(sessions) ? sessions : []).filter((session) =>
      wanted.has(session?.id),
    );
  } else {
    sourceSessions = Array.isArray(sessions) ? sessions : [];
  }
  const grouped = groupSessionsByDay(sourceSessions, days);

  const doc = await PDFDocument.create();
  doc.setTitle(ownerName ? `${ownerName}'s schedule` : branding.name);
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
  // sanitizeForFont's doc comment in ../pdf/kit.cjs for the tradeoff).
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
    // Whose personal copy this is, on the same line as the venue and the
    // tagline — the slot below carries the day label on every page, and a
    // personal document must keep naming its days too.
    const sub = [
      branding.tagline,
      branding.venueLine,
      isNonEmptyString(ownerName) ? `${ownerName} — personal schedule` : null,
    ]
      .filter(isNonEmptyString)
      .join(' · ');
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

const { methodNotAllowed, notFound, sendError, internal } = require('../core/errors.cjs');
const { requireAttendeeAccess } = require('../core/auth.cjs');

// Public generation has one cache slot and one in-flight build per container.
// The deployment keeps this handler alive between requests and caps instances.
const PUBLIC_PDF_TTL_MS = 60 * 1000;
const MAX_PUBLIC_SESSIONS = 1000;
const MAX_PUBLIC_SPEAKERS = 2000;
const PUBLIC_PDF_OPTIONS = Object.freeze({
  maxInstances: 1,
  concurrency: 20,
  cpu: 1,
  memory: '256MiB',
  timeoutSeconds: 60,
});

/** Read only referenced speakers, with bounded parallelism and total reads. */
async function publicSpeakerNames(db, sessions) {
  const ids = [...new Set(sessions.flatMap((s) =>
    Array.isArray(s.speakerIds) ? s.speakerIds : [],
  ).filter((id) => typeof id === 'string' && id.length > 0 && !id.includes('/')))];
  if (ids.length > MAX_PUBLIC_SPEAKERS) throw new Error('Public PDF speaker budget exceeded.');
  const names = Object.create(null);
  for (let offset = 0; offset < ids.length; offset += 50) {
    const docs = await Promise.all(ids.slice(offset, offset + 50).map((id) =>
      db.collection('speakers').doc(id).get(),
    ));
    for (const doc of docs) {
      const name = doc.exists ? deriveApprovedSpeakerName(doc.data()) : '';
      if (name) names[doc.id] = name;
    }
  }
  return names;
}

/**
 * Public artifact cache, independent of request headers/query parameters.
 * Config changes invalidate the single slot; schedule/speaker edits appear
 * within one minute of the next request. Failed builds also consume the
 * refresh budget, so an outage cannot turn every GET into a database scan.
 *
 * @param {{ db: FirebaseFirestore.Firestore, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'error'> }} deps
 */
function createBuildSchedulePdfHandler({ db, getConfig, now = Date.now, log = console }) {
  let cached = null;
  let inFlight = null;
  let retryAt = 0;

  return async function handler(req, res) {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    try {
      const config = await getConfig();
      if (config?.features?.schedulePdf !== true) {
        return notFound(res, 'The schedule PDF is not enabled for this event.');
      }
      const key = JSON.stringify([config.event, config.theme]);
      let artifact = cached?.key === key && now() < cached.expiresAt ? cached : null;
      if (!artifact) {
        if ((inFlight && inFlight.key !== key) || (!inFlight && now() < retryAt)) {
          res.set('Retry-After', String(Math.max(1, Math.ceil((retryAt - now()) / 1000))));
          return sendError(res, 429, 'resource-exhausted', 'The schedule PDF is refreshing. Try again shortly.');
        }
        if (!inFlight) {
          retryAt = now() + PUBLIC_PDF_TTL_MS;
          const promise = (async () => {
            const snap = await db.collection('cmsSchedule').where('visible', '==', true)
              .limit(MAX_PUBLIC_SESSIONS + 1).get();
            if (snap.docs.length > MAX_PUBLIC_SESSIONS) throw new Error('Public PDF session budget exceeded.');
            const sessions = snap.docs.map((doc) => doc.data());
            const speakerNamesById = await publicSpeakerNames(db, sessions);
            const bytes = await buildSchedulePdf({
              event: config.event, theme: config.theme, sessions, speakerNamesById,
            });
            cached = { key, bytes: Buffer.from(bytes), expiresAt: now() + PUBLIC_PDF_TTL_MS };
            return cached;
          })().finally(() => { inFlight = null; });
          inFlight = { key, promise };
        }
        artifact = await inFlight.promise;
      }

      res.status(200);
      const seconds = Math.max(0, Math.floor((artifact.expiresAt - now()) / 1000));
      res.set('Cache-Control', `public, max-age=0, s-maxage=${seconds}, must-revalidate`);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="schedule.pdf"');
      res.send(artifact.bytes);
    } catch (err) {
      log.error('buildSchedulePdf failed', err);
      internal(res, 'The schedule PDF could not be generated.');
    }
  };
}

/** Deployable export: buildSchedulePdf (public GET, spec §9). */
function createBuildMySchedulePdfHandler({ db, auth, getConfig, log = console }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    // The same flag gates the personal document and the public one: a
    // client that has turned the PDF off serves neither.
    const config = await getConfig();
    if (config?.features?.schedulePdf !== true) {
      return notFound(res, 'The schedule PDF is not enabled for this event.');
    }

    // THE CALLER IS THE ONLY SUBJECT. The uid comes from the verified ID
    // token and from nowhere else — the handler reads that caller's own
    // users/{uid}/bookmarks and nobody else's. A body that names a uid
    // names a different account: refused, never substituted, because a
    // personal programme is not public and a "read another person's
    // schedule" switch would make this endpoint the leak #172's projection
    // exists to prevent.
    const gate = await requireAttendeeAccess({ auth, db, getConfig }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const requestedUid = (req.body ?? {}).uid;
    if (typeof requestedUid === 'string' && requestedUid && requestedUid !== gate.uid) {
      return sendError(res, 403, 'forbidden', 'A personal schedule is only issued to its owner.');
    }

    try {
      const [membersSnap, userSnap, sessionsSnap, speakersSnap] = await Promise.all([
        db.collection(`users/${gate.uid}/bookmarks`).get(),
        db
          .collection('users')
          .doc(gate.uid)
          .get()
          .catch(() => null),
        db.collection('cmsSchedule').where('visible', '==', true).get(),
        db.collection('speakers').get().catch(() => ({ docs: [] })),
      ]);

      const onlySessionIds = membersSnap.docs.map((d) => d.id);
      const storedName = userSnap?.exists ? userSnap.data()?.displayName : null;
      const ownerName =
        typeof storedName === 'string' && storedName.trim() ? storedName.trim() : null;

      // Bookmark ids are document ids. A published body often has no id.
      // The document id wins over a stale id stored in the body.
      const sessions = sessionsSnap.docs.map((d) => ({ ...d.data(), id: d.id }));
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
        ownerName,
        onlySessionIds,
      });

      res.status(200);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="my-schedule.pdf"');
      res.send(Buffer.from(bytes));
    } catch (err) {
      log.error('buildMySchedulePdf failed', err);
      internal(res, 'The schedule PDF could not be generated.');
    }
  };
}

/** Deployable exports: buildSchedulePdf (public GET), buildMySchedulePdf (owner POST). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler, methods) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods,
    });
    if (handled) return;
    await handler(req, res);
  };

  let publicHandler;
  return {
    buildSchedulePdf: onRequest({ region, ...PUBLIC_PDF_OPTIONS }, withCors(async (req, res) => {
      publicHandler ||= createBuildSchedulePdfHandler(buildDeps());
      await publicHandler(req, res);
    }, ['GET'])),
    buildMySchedulePdf: onRequest({ region }, withCors(async (req, res) => {
      await createBuildMySchedulePdfHandler(buildDeps())(req, res);
    }, ['POST'])),
  };
}

module.exports = {
  buildSchedulePdf,
  createBuildSchedulePdfHandler,
  createBuildMySchedulePdfHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    PUBLIC_PDF_TTL_MS,
    MAX_PUBLIC_SESSIONS,
    MAX_PUBLIC_SPEAKERS,
    PUBLIC_PDF_OPTIONS,
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
