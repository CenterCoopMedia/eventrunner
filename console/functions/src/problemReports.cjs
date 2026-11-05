'use strict';

/**
 * "Report a problem" relay. The console and each client site's admin panel
 * post here; the report goes on to the operator's triage service, which
 * sends it to the operator in Telegram with File, File + fix and Ignore.
 * Nothing is stored in the console: the triage service owns the record.
 *
 * The caller must be signed in, with a verified email, to the console or to
 * a client site this console built (or one named in CONSOLE_REPORT_PROJECTS
 * for a site from before the console). A client site's ID token is checked
 * against that site's own Firebase project.
 *
 * The browser sends only named fields. Text is trimmed and bounded here;
 * the triage service checks it again and never puts the reporter's email or
 * the browser messages in a public issue.
 */

const crypto = require('node:crypto');
const { ConsoleError, sendError } = require('./http.cjs');
const { takeSlot } = require('./rateLimit.cjs');
const { siteNameOf } = require('./reviewAccess.cjs');
const { projectIdFor } = require('./consoleSettings.cjs');

const CATEGORIES = Object.freeze(['bug', 'suggestion', 'question']);
const SURFACES = Object.freeze(['console', 'admin']);
const LEVELS = Object.freeze(['log', 'info', 'warn', 'error']);
const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 4000;
const MAX_LOGS = 50;
const MAX_LOG_MESSAGE = 1000;
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const SITE_RE = /^[a-z0-9-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{0,64}$/;
const BUILT_STATUSES = Object.freeze(['building', 'ready', 'launched']);
const HOUR = 60 * 60 * 1000;
const PER_HOUR = 10;
const INTAKE_TIMEOUT_MS = 15000;

/** An origin a report may come from: the console, any eventrunner.org site, or a Firebase default host. */
function reportOriginAllowed(origin, extra = []) {
  if (typeof origin !== 'string') return false;
  if (extra.includes(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.origin !== origin) return false;
  const host = url.hostname;
  return host === 'eventrunner.org' || host.endsWith('.eventrunner.org')
    || host.endsWith('.web.app') || host.endsWith('.firebaseapp.com');
}

/** A page address the triage service will accept: https, a report origin, no query. */
function cleanPageUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || !reportOriginAllowed(url.origin)) return null;
  url.search = '';
  return url.toString();
}

/** Strip values that look like credentials or addresses out of a browser message. */
function redact(text) {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [removed]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[token removed]')
    .replace(/\b(key|token|secret|password|apikey|api_key|oobCode|code)=([^&\s"']+)/gi, '$1=[removed]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]');
}

function cleanLogs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MAX_LOGS).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const level = LEVELS.includes(entry.level) ? entry.level : 'log';
    const message = typeof entry.message === 'string' ? redact(entry.message).slice(0, MAX_LOG_MESSAGE) : '';
    return message ? [{ level, message }] : [];
  });
}

/**
 * The report to forward, or a ConsoleError naming the field to fix.
 * @returns {{ category, description, url, surface, site, version, consoleLogs }}
 */
function readReport(body) {
  const category = CATEGORIES.includes(body.category) ? body.category : null;
  if (!category) throw Object.assign(new ConsoleError(400, 'bad-request', 'Choose what kind of report this is.'), { field: 'category' });
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) {
    throw Object.assign(new ConsoleError(400, 'bad-request',
      `Describe the problem in ${MIN_DESCRIPTION} to ${MAX_DESCRIPTION} characters.`), { field: 'description' });
  }
  const surface = SURFACES.includes(body.surface) ? body.surface : null;
  const url = cleanPageUrl(body.url);
  const site = typeof body.site === 'string' && SITE_RE.test(body.site) ? body.site : null;
  const version = typeof body.version === 'string' && VERSION_RE.test(body.version) ? body.version : '';
  if (!surface || !url || site === null) throw new ConsoleError(400, 'bad-request', 'The report could not be read. Reload the page and try again.');
  return { category, description, url, surface, site: surface === 'console' ? '' : site, version, consoleLogs: cleanLogs(body.consoleLogs) };
}

/** The unverified `aud` of a Firebase ID token: which project to check it against. */
function tokenProject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.aud === 'string' && PROJECT_ID_RE.test(payload.aud) ? payload.aud : null;
  } catch {
    return null;
  }
}

/** True when this console built a site in that project, or the operator listed it. */
async function knownClientProject(db, projectId, extraProjects) {
  if (extraProjects.includes(projectId)) return true;
  const snap = await db.collection('applications').where('status', 'in', BUILT_STATUSES).get();
  return snap.docs.some((doc) => {
    const app = doc.data();
    const stored = app.review?.settings?.projectId;
    const name = siteNameOf(app);
    return stored === projectId || (!stored && name && projectIdFor(name) === projectId);
  });
}

/**
 * The verified reporter. `authFor(projectId)` returns an Auth for a client
 * project; the console's own Auth checks console tokens with revocation.
 */
async function verifyReporter({ auth, authFor, db, consoleProject, extraProjects }, token) {
  const project = token ? tokenProject(token) : null;
  if (!project) return null;
  let decoded = null;
  try {
    if (project === consoleProject) {
      decoded = await auth.verifyIdToken(token, true);
    } else if (await knownClientProject(db, project, extraProjects)) {
      decoded = await authFor(project).verifyIdToken(token);
    }
  } catch {
    decoded = null;
  }
  const email = typeof decoded?.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!decoded?.uid || !email || decoded.email_verified !== true) return null;
  return { uid: decoded.uid, email, project };
}

/** Post one report to the triage service. Throws on any refusal. */
async function forwardReport({ fetch, intake }, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTAKE_TIMEOUT_MS);
  try {
    const res = await fetch(intake.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${intake.secret}`,
        'CF-Access-Client-Id': intake.accessId,
        'CF-Access-Client-Secret': intake.accessSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success !== true || typeof body.id !== 'string') {
      throw new Error(`triage service answered ${res.status}`);
    }
    return body.id;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The onRequest handler body. CORS is answered by the caller.
 * deps: { auth, authFor, db, fetch, intake: { url, secret, accessId, accessSecret },
 *   consoleProject, extraProjects, now, log }
 */
function reportProblemHandler(deps) {
  const log = deps.log || console;
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.set('Allow', 'POST');
      sendError(res, 405, 'method-not-allowed', 'Use POST.');
      return;
    }
    const raw = typeof req.get === 'function' ? req.get('Authorization') : req.headers?.authorization;
    const token = typeof raw === 'string' ? (raw.match(/^Bearer\s+(\S+)$/i) || [])[1] : null;
    const reporter = await verifyReporter(deps, token);
    if (!reporter) {
      sendError(res, 401, 'unauthorized', 'Sign in to send a report.');
      return;
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      sendError(res, 400, 'bad-request', 'The request is not valid.');
      return;
    }
    try {
      const report = readReport(body);
      if (!deps.intake?.url || !deps.intake.secret || !deps.intake.accessId || !deps.intake.accessSecret) {
        throw new ConsoleError(503, 'unavailable', 'Reports are not switched on yet. Email us instead.');
      }
      await takeSlot(deps.db, {
        key: `report-${crypto.createHash('sha256').update(`${reporter.project}:${reporter.uid}`).digest('hex').slice(0, 40)}`,
        max: PER_HOUR,
        windowMs: HOUR,
        now: deps.now,
        message: 'You have sent several reports in the last hour. Try again later.',
      });
      const id = await forwardReport(deps, {
        request_id: crypto.randomBytes(16).toString('hex'),
        category: report.category,
        description: report.description,
        email: reporter.email,
        url: report.url,
        surface: report.surface,
        site: report.site,
        version: report.version,
        consoleLogs: report.consoleLogs,
      }).catch((err) => {
        throw Object.assign(new ConsoleError(502, 'unavailable', 'The report could not be sent. Try again in a minute.'), { cause: err });
      });
      res.status(200).json({ id });
    } catch (err) {
      if (err instanceof ConsoleError) {
        if (err.cause) log.error('reportProblem: forward failed', err.cause.message);
        if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
        sendError(res, err.status, err.code, err.message, typeof err.field === 'string' ? { field: err.field } : {});
        return;
      }
      log.error('reportProblem failed', err);
      sendError(res, 500, 'internal', 'Something went wrong. Try again.');
    }
  };
}

module.exports = { cleanLogs, cleanPageUrl, readReport, redact, reportOriginAllowed, reportProblemHandler, tokenProject, verifyReporter };
