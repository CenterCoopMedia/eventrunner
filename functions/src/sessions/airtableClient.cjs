'use strict';

/**
 * Read-only Airtable REST client for session pitch intake.
 *
 * It lists the records of one operator-approved base, table and optional
 * view. It never writes to Airtable. The only origin it calls is
 * https://api.airtable.com. The Functions emulator may name a loopback
 * origin through EVENT_AIRTABLE_API_ORIGIN so the browser suite can use a
 * fake API; a deployed function ignores that variable.
 *
 * The personal access token reaches this module as an argument. It goes
 * into the Authorization header and nowhere else: every message this module
 * returns or logs passes through `redact` first.
 */

const AIRTABLE_ORIGIN = 'https://api.airtable.com';
const BASE_ID_RE = /^app[A-Za-z0-9]{14}$/;
const TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/;
const VIEW_ID_RE = /^viw[A-Za-z0-9]{14}$/;
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const LOOPBACK_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
const MAX_NAME_LENGTH = 100;

const FIELD_KEYS = Object.freeze(['externalId', 'email', 'title', 'description', 'organization', 'format', 'consent']);
const REQUIRED_FIELD_KEYS = Object.freeze(['email', 'title', 'description', 'consent']);
const SCHEDULE_MINUTES = Object.freeze([0, 15, 60]);

// Airtable allows 5 requests per second per base and answers 429 above it,
// with a 30-second wait before the next request succeeds. One run sends at
// most 4 requests per second and reads at most MAX_PAGES pages.
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MIN_REQUEST_GAP_MS = 250;
const RATE_LIMIT_WAIT_MS = 30_000;
const SERVER_ERROR_WAIT_MS = 2_000;
const MAX_ATTEMPTS = 3;
// The refresh function has 300 seconds. The read stops at 240, so the run
// still has time to save what it read and to release its lease.
const LIST_BUDGET_MS = 240_000;

class AirtableError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'AirtableError';
    this.code = code;
    this.httpStatus = status;
  }
}

/**
 * Remove a token from text before it is stored, returned or logged.
 * Covers the exact token, any Airtable personal access token shape, and a
 * bearer header that an upstream error might echo.
 */
function redact(text, token) {
  let out = String(text ?? '');
  if (typeof token === 'string' && token.length >= 4) out = out.split(token).join('[redacted]');
  return out
    .replace(/\bpat[A-Za-z0-9]{8,}(\.[A-Za-z0-9]+)?/g, '[redacted]')
    .replace(/\bkey[A-Za-z0-9]{14}\b/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

function readName(value, field, { required, idPattern, idLabel }) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return required ? { ok: false, message: `${field}: is required.` } : { ok: true, value: null };
  }
  if (typeof value !== 'string') return { ok: false, message: `${field}: must be text.` };
  const trimmed = value.trim();
  if (trimmed.length > MAX_NAME_LENGTH || CONTROL_RE.test(trimmed)) {
    return { ok: false, message: `${field}: use ${MAX_NAME_LENGTH} characters or fewer, without line breaks.` };
  }
  // A value that starts like an Airtable id must be a whole id, so a typo
  // fails here and not at the first refresh.
  if (idPattern && /^(tbl|viw)[A-Za-z0-9]+$/.test(trimmed) && trimmed.startsWith(idLabel) && !idPattern.test(trimmed)) {
    return { ok: false, message: `${field}: an Airtable ${idLabel} id has 17 characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate the operator's connection settings. Returns the stored shape or
 * the first problem. Unknown keys are dropped.
 */
function readAirtableSource(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof source.enabled !== 'boolean') return { ok: false, message: 'enabled: must be true or false.' };
  const baseId = typeof source.baseId === 'string' ? source.baseId.trim() : '';
  if (!BASE_ID_RE.test(baseId)) return { ok: false, message: 'baseId: use the base id from the Airtable address (app followed by 14 letters or numbers).' };
  const table = readName(source.table, 'table', { required: true, idPattern: TABLE_ID_RE, idLabel: 'tbl' });
  if (!table.ok) return table;
  const view = readName(source.view, 'view', { required: false, idPattern: VIEW_ID_RE, idLabel: 'viw' });
  if (!view.ok) return view;
  if (!SCHEDULE_MINUTES.includes(source.scheduleMinutes)) {
    return { ok: false, message: `scheduleMinutes: must be one of ${SCHEDULE_MINUTES.join(', ')}.` };
  }
  const rawMap = source.fieldMap && typeof source.fieldMap === 'object' && !Array.isArray(source.fieldMap) ? source.fieldMap : {};
  const fieldMap = {};
  for (const key of FIELD_KEYS) {
    const name = readName(rawMap[key], `fieldMap.${key}`, { required: REQUIRED_FIELD_KEYS.includes(key) });
    if (!name.ok) return name;
    fieldMap[key] = name.value;
  }
  const used = Object.values(fieldMap).filter(Boolean);
  if (new Set(used).size !== used.length) return { ok: false, message: 'fieldMap: map each Airtable field to one pitch field only.' };
  return { ok: true, value: { enabled: source.enabled, baseId, table: table.value, view: view.value, fieldMap, scheduleMinutes: source.scheduleMinutes } };
}

/**
 * The origin to call. Only the Functions emulator may use a loopback
 * origin, and only through an explicit variable; everything else calls
 * Airtable.
 */
function airtableOrigin(env = process.env) {
  const override = typeof env.EVENT_AIRTABLE_API_ORIGIN === 'string' ? env.EVENT_AIRTABLE_API_ORIGIN.trim() : '';
  if (env.FUNCTIONS_EMULATOR === 'true' && LOOPBACK_ORIGIN_RE.test(override)) return override;
  return AIRTABLE_ORIGIN;
}

function listUrl(origin, source, offset) {
  const url = new URL(`/v0/${source.baseId}/${encodeURIComponent(source.table)}`, origin);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  if (source.view) url.searchParams.set('view', source.view);
  // Ask only for the mapped fields, so unrelated columns never leave Airtable.
  for (const name of Object.values(source.fieldMap)) if (name) url.searchParams.append('fields[]', name);
  if (offset) url.searchParams.set('offset', offset);
  if (url.origin !== origin) throw new AirtableError('bad-request', 'The Airtable address is not valid.');
  return url.toString();
}

function failureFor(status, type) {
  const suffix = typeof type === 'string' && /^[A-Z_]{1,64}$/.test(type) ? ` (Airtable: ${type})` : '';
  if (status === 401) return new AirtableError('token-rejected', `Airtable refused the access token. Check that the token is current and has the data.records:read scope${suffix}.`, status);
  if (status === 403) return new AirtableError('forbidden', `The access token cannot read this base. Add the base to the token's access list${suffix}.`, status);
  if (status === 404) return new AirtableError('not-found', `Airtable cannot find this base, table or view. Check the connection settings${suffix}.`, status);
  if (status === 422) return new AirtableError('invalid-request', `Airtable refused the request. Check the view and every mapped field name${suffix}.`, status);
  if (status === 429) return new AirtableError('rate-limited', 'Airtable asked Event Runner to slow down. Try the refresh again in one minute.', status);
  if (status >= 500) return new AirtableError('unavailable', 'Airtable is not available. Try the refresh again later.', status);
  return new AirtableError('unexpected-status', `Airtable answered with status ${status}${suffix}.`, status);
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

/**
 * List every record the view shows, up to MAX_PAGES pages.
 *
 * @returns {Promise<{ records: Array<{ id: string, fields: object }>, complete: boolean, requests: number }>}
 *   `complete` is false when the run stopped at the page limit; a caller
 *   must not treat an absent record as removed then.
 */
async function listAirtableRecords({ fetchImpl, token, source, env = process.env, sleep, now = Date.now, maxPages = MAX_PAGES }) {
  if (typeof token !== 'string' || !token.trim()) throw new AirtableError('no-token', 'The AIRTABLE_API_TOKEN secret is not set for this deployment.');
  const deadline = now() + LIST_BUDGET_MS;
  const sleepFor = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const wait = async (ms) => {
    if (now() + ms >= deadline) {
      throw new AirtableError('timed-out', 'Airtable answered too slowly or asked Event Runner to slow down too often. The refresh stopped before its time limit and changed no pitch. Try again in a few minutes.');
    }
    await sleepFor(ms);
  };
  const origin = airtableOrigin(env);
  const records = [];
  let offset = null;
  let requests = 0;
  let lastRequestAt = null;
  for (let page = 0; page < maxPages; page += 1) {
    let body = null;
    for (let attempt = 1; ; attempt += 1) {
      if (lastRequestAt !== null) {
        const gap = MIN_REQUEST_GAP_MS - (now() - lastRequestAt);
        if (gap > 0) await wait(gap);
      }
      lastRequestAt = now();
      requests += 1;
      let response;
      try {
        response = await fetchImpl(listUrl(origin, source, offset), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/json' },
          redirect: 'error',
          // A request that hangs ends at the deadline, not at the function timeout.
          signal: AbortSignal.timeout(Math.max(1, deadline - now())),
        });
      } catch (err) {
        if (err instanceof AirtableError) throw err;
        if (attempt < MAX_ATTEMPTS) { await wait(SERVER_ERROR_WAIT_MS); continue; }
        throw new AirtableError('network', 'Event Runner could not reach Airtable. Try the refresh again later.');
      }
      if (response.ok) { body = await readJson(response); break; }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        await wait(response.status === 429 ? RATE_LIMIT_WAIT_MS : SERVER_ERROR_WAIT_MS);
        continue;
      }
      const detail = await readJson(response);
      throw failureFor(response.status, detail?.error?.type ?? detail?.error);
    }
    if (!body || !Array.isArray(body.records)) throw new AirtableError('bad-response', 'Airtable sent a response Event Runner cannot read.');
    for (const record of body.records) {
      if (!record || typeof record.id !== 'string' || !RECORD_ID_RE.test(record.id)) {
        throw new AirtableError('bad-response', 'Airtable sent a record without a valid record id.');
      }
      records.push({ id: record.id, fields: record.fields && typeof record.fields === 'object' ? record.fields : {} });
    }
    offset = typeof body.offset === 'string' && body.offset ? body.offset : null;
    if (!offset) return { records, complete: true, requests };
  }
  return { records, complete: false, requests };
}

module.exports = {
  AirtableError,
  readAirtableSource,
  listAirtableRecords,
  airtableOrigin,
  redact,
  internals: {
    AIRTABLE_ORIGIN, BASE_ID_RE, TABLE_ID_RE, VIEW_ID_RE, RECORD_ID_RE, FIELD_KEYS, REQUIRED_FIELD_KEYS,
    SCHEDULE_MINUTES, PAGE_SIZE, MAX_PAGES, MIN_REQUEST_GAP_MS, RATE_LIMIT_WAIT_MS, MAX_ATTEMPTS, LIST_BUDGET_MS, listUrl,
  },
};
