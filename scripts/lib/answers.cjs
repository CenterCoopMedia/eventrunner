'use strict';

/**
 * Client answers → the five Tier B config documents (spec §2.2, §5.1 step b/c).
 *
 * Pure: no prompting, no Firestore, no clock of its own. `init-event.cjs`
 * collects answers (from `--answers file.json` or the interactive prompts
 * declared here) and hands them to `buildConfigDocs`, which fills defaults,
 * applies the Tier-A-wins rule (§2.2), and runs the REAL shared validators
 * before anything is written. A deployment therefore cannot be seeded into
 * a shape the admin endpoints would later reject.
 *
 * Answers-file shape (every key optional except the ones the validators
 * require — `event.name`, `event.shortName`, `event.timezone`,
 * `event.sender.email`, and at least one admin email):
 *
 *   {
 *     "adminEmails": ["ops@example.org"],
 *     "event":    { name, shortName, tagline, timezone, days: [...], venue,
 *                   registration, sender, legal, social, seo },
 *     "features": { ...booleans },
 *     "theme":    { colors, fonts, texture, radius, logos },
 *     "badges":   { categories: [...] },
 *     "providers":{ email, ticketing, notifier }
 *   }
 *
 * Provider selection is NOT read from the answers file: it is Tier A
 * (`EVENT_EMAIL_PROVIDER`, `EVENT_TICKETING_PROVIDER`,
 * `EVENT_OPERATOR_NOTIFIER`), and §2.2 says Tier A wins on conflict, with
 * the Firestore copy existing only so the admin UI can display it
 * read-only. An answers file that sets one gets a warning, not a silent
 * override of the deployed environment.
 */

const {
  validateEventConfig,
  validateFeatures,
  validateTheme,
  validateBadgesConfig,
  KNOWN_FEATURE_KEYS,
} = require('shared/config');
const { defaultTheme } = require('./theme.cjs');

/** Feature toggles default false except the first four (spec §2.2). */
const DEFAULT_ON_FEATURES = Object.freeze(['schedule', 'speakers', 'sponsors', 'attendeeDirectory']);

/**
 * The interactive prompt set. Declared as data so the question list, its
 * defaults, and its validation are testable without a TTY; init-event.cjs
 * walks it with node:readline when `--answers` is absent.
 *
 * `path` is a dotted path into the answers object. `parse` turns the typed
 * string into the stored value; returning an Error means "ask again".
 */
const PROMPTS = Object.freeze([
  { path: 'event.name', question: 'Event name (e.g. 2027 Regional Media Summit)', required: true },
  { path: 'event.shortName', question: 'Short name, used in email subjects', required: true },
  { path: 'event.tagline', question: 'Tagline (one line)', required: false },
  { path: 'event.timezone', question: 'IANA timezone', required: true, default: 'UTC' },
  {
    path: 'event.days',
    question: 'Event days as comma-separated ISO dates (YYYY-MM-DD), earliest first',
    required: false,
    parse: parseDayList,
  },
  { path: 'event.venue.name', question: 'Venue name', required: false },
  { path: 'event.venue.city', question: 'Venue city', required: false },
  { path: 'event.sender.email', question: 'Outbound sender email address', required: true },
  { path: 'event.sender.name', question: 'Outbound sender display name', required: false },
  { path: 'event.legal.operatorName', question: 'Organization operating the event', required: true },
  { path: 'event.legal.supportEmail', question: 'Support email address', required: true },
  { path: 'event.legal.conductEmail', question: 'Code-of-conduct contact address', required: false },
  {
    path: 'adminEmails',
    question: 'First admin email addresses (comma separated)',
    required: true,
    parse: parseEmailList,
  },
]);

/**
 * "2027-05-13, 2027-05-14" → the `config/event.days[]` array, with stable
 * `day-N` ids and a 09:00–17:00 default window an admin edits later.
 *
 * @param {string} raw
 * @returns {Array<object>|Error}
 */
function parseDayList(raw) {
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const days = [];
  for (const [i, date] of parts.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Error(`"${date}" is not a YYYY-MM-DD date`);
    }
    days.push({
      id: `day-${i + 1}`,
      label: `Day ${i + 1}`,
      date,
      startTime: '09:00',
      endTime: '17:00',
    });
  }
  return days;
}

/**
 * Comma-separated addresses → a lowercased, de-duplicated list.
 * Lowercase is a storage invariant, not a nicety: firestore.rules compares
 * `adminEmails` against `request.auth.token.email.lower()`, so a
 * mixed-case entry is an admin who can never authenticate.
 *
 * @param {string} raw
 * @returns {string[]|Error}
 */
function parseEmailList(raw) {
  const parts = String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = parts.filter((p) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
  if (bad.length > 0) return new Error(`not email addresses: ${bad.join(', ')}`);
  return [...new Set(parts)];
}

/** @param {object} target @param {string} path dotted @param {*} value */
function setPath(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** @param {object} source @param {string} path dotted @returns {*} */
function getPath(source, path) {
  return path.split('.').reduce((node, part) => (node == null ? undefined : node[part]), source);
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** `fallback` for null/undefined/empty-string, otherwise `value`. */
function orDefault(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return value;
}

/**
 * Read the answers JSON text. Returns a typed failure instead of throwing
 * so the CLI prints one diagnostic shape for every input problem.
 *
 * @param {string} text
 * @returns {{ ok: true, answers: object } | { ok: false, errors: string[] }}
 */
function parseAnswersFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`answers file is not valid JSON: ${err.message}`] };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, errors: ['answers file must contain a JSON object'] };
  }
  const errors = [];
  const known = ['adminEmails', 'event', 'features', 'theme', 'badges', 'providers'];
  for (const key of Object.keys(parsed)) {
    if (!known.includes(key)) errors.push(`${key}: unknown top-level key in the answers file`);
  }
  if (parsed.adminEmails !== undefined && !Array.isArray(parsed.adminEmails)) {
    errors.push('adminEmails: must be an array of email addresses');
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, answers: parsed };
}

/**
 * The features doc: every known key present, the §2.2 four on, the rest
 * off, answers-file overrides applied on top. Unknown keys are dropped
 * here rather than passed through, so a typo surfaces as a validation
 * error naming the key instead of a silently ignored toggle.
 *
 * @param {object} [overrides]
 * @returns {{ features: object, warnings: string[] }}
 */
function buildFeatures(overrides = {}) {
  const warnings = [];
  const features = {};
  for (const key of KNOWN_FEATURE_KEYS) features[key] = DEFAULT_ON_FEATURES.includes(key);
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!KNOWN_FEATURE_KEYS.includes(key)) {
      warnings.push(`features.${key}: unknown feature key, ignored`);
      continue;
    }
    features[key] = value;
  }
  return { features, warnings };
}

/**
 * The providers doc. Tier A is the source of truth (§2.2); the answers
 * file may only supply the non-selection details (`messageStream`,
 * `operatorEmail`).
 *
 * @param {{ tierA: object, overrides?: object }} args
 * @returns {{ providers: object, warnings: string[] }}
 */
function buildProviders({ tierA, overrides = {} }) {
  const warnings = [];
  const over = isPlainObject(overrides) ? overrides : {};
  for (const [group, key] of [['email', 'provider'], ['ticketing', 'provider'], ['notifier', 'sink']]) {
    if (isPlainObject(over[group]) && over[group][key] !== undefined) {
      warnings.push(
        `providers.${group}.${key}: ignored — provider selection is Tier A ` +
        '(EVENT_EMAIL_PROVIDER / EVENT_TICKETING_PROVIDER / EVENT_OPERATOR_NOTIFIER)',
      );
    }
  }
  return {
    providers: {
      email: {
        provider: tierA.emailProvider || 'console',
        messageStream: orDefault(isPlainObject(over.email) ? over.email.messageStream : null, null),
      },
      ticketing: {
        provider: tierA.ticketingProvider || 'none',
        externalEventId: tierA.ticketingEventId || null,
        webhookRegisteredAt: null,
        webhookId: null,
      },
      notifier: {
        sink: tierA.operatorNotifier || 'none',
        operatorEmail: orDefault(isPlainObject(over.notifier) ? over.notifier.operatorEmail : null, null),
      },
    },
    warnings,
  };
}

/**
 * The event doc, with every §2.2 field present so a half-seeded document
 * never makes a consumer guess whether a field is absent or empty.
 *
 * `legal.reviewRequired` is hardcoded true and cannot be answered away:
 * §5.5 says both legal pages seed as unreviewed templates on every fresh
 * deployment, and only an admin — after counsel signs off — clears it from
 * Settings. `sender.domainVerified` is false for the same reason: only
 * verify-sender-domain.cjs may set it (§1.3).
 *
 * @param {{ answers: object, tierA: object }} args
 * @returns {object} config/event
 */
function buildEvent({ answers, tierA }) {
  const src = isPlainObject(answers.event) ? answers.event : {};
  const venue = isPlainObject(src.venue) ? src.venue : {};
  const sender = isPlainObject(src.sender) ? src.sender : {};
  const legal = isPlainObject(src.legal) ? src.legal : {};
  const social = isPlainObject(src.social) ? src.social : {};
  const seo = isPlainObject(src.seo) ? src.seo : {};
  const registration = isPlainObject(src.registration) ? src.registration : {};

  return {
    name: orDefault(src.name, ''),
    shortName: orDefault(src.shortName, ''),
    tagline: orDefault(src.tagline, ''),
    timezone: orDefault(src.timezone, 'UTC'),
    days: Array.isArray(src.days) ? src.days : [],
    // The event's concurrent tracks (design brief §4.6). Empty on a fresh
    // deployment: an event runs no lines until an operator says it does.
    tracks: Array.isArray(src.tracks) ? src.tracks : [],
    registration: {
      opensAt: orDefault(registration.opensAt, null),
      closesAt: orDefault(registration.closesAt, null),
      externalUrl: orDefault(registration.externalUrl, null),
    },
    venue: {
      name: orDefault(venue.name, ''),
      addressLine1: orDefault(venue.addressLine1, ''),
      addressLine2: orDefault(venue.addressLine2, null),
      city: orDefault(venue.city, ''),
      region: orDefault(venue.region, ''),
      postalCode: orDefault(venue.postalCode, ''),
      country: orDefault(venue.country, ''),
      mapUrl: orDefault(venue.mapUrl, null),
      // THE MOVEMENT MODEL (shared/venue.cjs). Both empty on a fresh
      // deployment: a venue has no recorded places until somebody walks it
      // and writes them down, and an empty list is the honest starting
      // state — the schedule then states no movement at all, rather than
      // guessing one from two room names.
      places: Array.isArray(venue.places) ? venue.places : [],
      movements: Array.isArray(venue.movements) ? venue.movements : [],
    },
    sender: {
      email: orDefault(sender.email, ''),
      name: orDefault(sender.name, orDefault(src.shortName, '')),
      replyTo: orDefault(sender.replyTo, null),
      // Written only by verify-sender-domain.cjs (spec §1.3, §5.1 step 7).
      domainVerified: false,
      domainVerifiedAt: null,
    },
    legal: {
      operatorName: orDefault(legal.operatorName, ''),
      postalAddressHtml: orDefault(
        legal.postalAddressHtml,
        '[Replace] Operator postal address for the email footer.',
      ),
      supportEmail: orDefault(legal.supportEmail, ''),
      conductEmail: orDefault(legal.conductEmail, orDefault(legal.supportEmail, '')),
      // §5.5: true on every fresh deployment, by construction.
      reviewRequired: true,
    },
    social: {
      hashtag: orDefault(social.hashtag, null),
      handles: Array.isArray(social.handles) ? social.handles : [],
    },
    // §2.5: a fresh seed is never public by accident.
    announcedAt: null,
    archivedAt: null,
    seo: {
      description: orDefault(
        seo.description,
        '[Replace] One-sentence description of the event for search and social cards.',
      ),
      defaultOgImagePath: orDefault(seo.defaultOgImagePath, 'branding/og-default.svg'),
      organizerName: orDefault(seo.organizerName, orDefault(legal.operatorName, '')),
      organizerUrl: orDefault(seo.organizerUrl, tierA.publicUrl || null),
    },
    // Operator attestation for the §5.1.1 Auth readiness row. Recorded by
    // `init-event.cjs --attest-auth` after the manual console steps (§5.6
    // items 1–2), never inferred: nothing in the Admin SDK reports whether
    // a sign-in provider is enabled.
    auth: {
      googleProviderEnabled: false,
      authorizedDomainsConfigured: false,
      attestedAt: null,
      attestedBy: null,
    },
  };
}

/**
 * Overlay a client's theme answers on the neutral defaults, one level
 * deep for the map-valued keys.
 *
 * A top-level spread is wrong here in a way that only shows up in the
 * browser: `{ colors: { brandPrimary } }` would REPLACE the whole default
 * palette, and the generated stylesheet would then be missing most of its
 * custom properties — every `rgb(var(--brand-ink-rgb))` utility resolving
 * to nothing. A client who names one brand color means "this one is
 * different", not "drop the other twelve".
 *
 * `placeholderLogos` is recomputed rather than merged: a slot a client
 * supplied their own asset for is no longer a placeholder, and the
 * launch-readiness branding row reads exactly this list.
 *
 * @param {object} base defaultTheme()
 * @param {*} overrides answers.theme
 * @returns {object}
 */
function mergeTheme(base, overrides) {
  if (!isPlainObject(overrides)) return base;
  const merged = { ...base, ...overrides };
  for (const key of ['colors', 'fonts', 'logos']) {
    if (isPlainObject(overrides[key])) merged[key] = { ...base[key], ...overrides[key] };
  }
  if (isPlainObject(overrides.logos)) {
    const supplied = new Set(Object.keys(overrides.logos));
    merged.placeholderLogos = base.placeholderLogos.filter((slot) => !supplied.has(slot));
  }
  return merged;
}

/** The badges doc: an empty, valid skeleton a client fills in later. */
function defaultBadges() {
  return { categories: [] };
}

/**
 * Build and validate all six documents init writes (§5.1 steps b–c).
 *
 * @param {{ answers: object, tierA: object, now?: () => number }} args
 * @returns {{ ok: boolean, errors: string[], warnings: string[], docs: object }}
 *   `docs` is `{ event, features, theme, badges, providers, bootstrap }`;
 *   it is returned even when `ok` is false so a caller can show what it
 *   would have written next to the errors.
 */
function buildConfigDocs({ answers, tierA, now = Date.now }) {
  const errors = [];
  const warnings = [];

  const event = buildEvent({ answers, tierA });
  const { features, warnings: featureWarnings } = buildFeatures(answers.features);
  const { providers, warnings: providerWarnings } = buildProviders({ tierA, overrides: answers.providers });
  warnings.push(...featureWarnings, ...providerWarnings);

  const theme = mergeTheme(defaultTheme(), answers.theme);
  const badges = isPlainObject(answers.badges) ? answers.badges : defaultBadges();

  const adminEmails = Array.isArray(answers.adminEmails)
    ? [...new Set(answers.adminEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (adminEmails.length === 0) {
    errors.push('adminEmails: at least one first-admin address is required (--admin or the answers file)');
  }
  for (const email of adminEmails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`adminEmails: "${email}" is not an email address`);
    }
  }

  for (const [label, verdict] of [
    ['config/event', validateEventConfig(event)],
    ['config/features', validateFeatures(features)],
    ['config/theme', validateTheme(theme)],
    ['config/badges', validateBadgesConfig(badges)],
  ]) {
    if (!verdict.ok) errors.push(...verdict.errors.map((e) => `${label}: ${e}`));
  }

  const createdAt = new Date(now()).toISOString();
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    docs: {
      event,
      features,
      theme,
      badges,
      providers,
      bootstrap: { adminEmails, createdAt },
    },
  };
}

module.exports = {
  PROMPTS,
  DEFAULT_ON_FEATURES,
  parseAnswersFile,
  parseDayList,
  parseEmailList,
  buildConfigDocs,
  buildEvent,
  buildFeatures,
  buildProviders,
  mergeTheme,
  defaultBadges,
  internals: { setPath, getPath, orDefault, isPlainObject },
};
