'use strict';

/**
 * Event templates: reuse a past event's reviewed branding, page templates
 * and selected static settings in a NEW Firebase project (issue #328).
 *
 * Each event keeps its own project (README "Operating model"). A template
 * is a JSON file an operator exports from the source project, reviews, and
 * hands to `init-event.cjs --template` against a fresh target project. No
 * code path here reads from one project and writes to another: the export
 * only reads, and the apply only writes what the file holds.
 *
 * ALLOWLIST, NOT DENYLIST. The export copies only what the tables below
 * name. A collection, config document, event field, page key or block
 * field that is not listed stays behind, so a collection added next year
 * is excluded until somebody adds it here on purpose. Users, tickets,
 * pitches, credentials, the admin allowlist (`config/bootstrap`), email
 * logs and every operational record are excluded by construction; the
 * inventory names them so the operator can see they were left out.
 *
 * The apply re-checks the same allowlist, so a hand-edited template that
 * adds `bootstrap`, `event.sender` or an unknown block field is refused,
 * not quietly trimmed.
 */

const { KNOWN_FEATURE_KEYS } = require('shared/config');
const { validatePageDoc } = require('../../functions/src/cms/pages.cjs');
const { BLOCK_TYPES } = require('../../functions/src/cms/blockTypes.cjs');
const { LEGAL_PAGE_IDS, defaultPages, internals: { CONFIG_SEEDS } } = require('./seed.cjs');
const { BRANDING_ASSETS } = require('./branding.cjs');

const TEMPLATE_KIND = 'eventrunner-event-template';
const TEMPLATE_VERSION = 1;

/**
 * `config/event` fields a template carries, as dotted paths. Everything
 * else stays behind: the name, dates, venue, tracks and registration
 * window belong to the new event; the sender, the auth attestation and
 * the legal review flag are checks the new project must pass on its own.
 */
const EVENT_TEMPLATE_FIELDS = Object.freeze([
  'tagline',
  'timezone',
  'legal.operatorName',
  'legal.postalAddressHtml',
  'legal.supportEmail',
  'legal.conductEmail',
  'social.hashtag',
  'social.handles',
  'seo.description',
  'seo.organizerName',
  'seo.organizerUrl',
  'seo.defaultOgImagePath',
  'registration.actionLabel',
]);

/**
 * `config/theme` keys a template carries. `logos` and `placeholderLogos`
 * stay behind: they name Storage objects in the source bucket, and the
 * target starts on the placeholders until the operator uploads the files.
 */
const THEME_TEMPLATE_KEYS = Object.freeze([
  'preset', 'colors', 'fonts', 'optionPicks', 'tokens', 'mode', 'header',
  'texture', 'radius', 'density', 'navPlacement', 'adminScheme', 'motifSet', 'brandColor',
]);

/** Page document keys (functions/src/cms/pages.cjs PAGE_KEYS). */
const PAGE_TEMPLATE_KEYS = Object.freeze([
  'id', 'label', 'title', 'path', 'icon', 'order', 'visible', 'systemPage', 'sections', 'layout', 'template',
]);

/** Keys every content block carries besides its block type's own fields. */
const CONTENT_BASE_KEYS = Object.freeze(['id', 'section', 'field', 'blockType', 'visible', 'order']);

/** Collections a template reads, and from which documents. */
const INCLUDED = Object.freeze({
  'config/event': `selected fields: ${EVENT_TEMPLATE_FIELDS.join(', ')}`,
  'config/theme': 'colours, fonts, style and layout choices (not the logo files)',
  'config/features': 'feature switches',
  'config/badges': 'badge categories',
  cmsPages: 'live page documents and their section structure',
  cmsContent: 'live content blocks on the selected pages, except the legal pages',
});

/**
 * Why each known collection stays behind. Any collection not named here or
 * in INCLUDED is reported as "not on the template allowlist".
 */
const EXCLUDED_REASONS = Object.freeze({
  users: 'accounts and profiles',
  users_public: 'accounts and profiles',
  schedule_shares: 'accounts and profiles',
  sessionBookmarks: 'accounts and profiles',
  sessionReactions: 'accounts and profiles',
  organization_representatives: 'accounts and profiles',
  organization_edit_requests: 'accounts and profiles',
  speakers: 'speaker records',
  speakers_public: 'speaker records',
  speaker_slugs: 'speaker records',
  speaker_invites: 'credentials',
  auth_challenges: 'credentials',
  auth_rate_limits: 'rate limits',
  auth_send_ceiling: 'rate limits',
  feedback_rate_limits: 'rate limits',
  change_request_rate_limits: 'rate limits',
  session_pitch_rate_limits: 'rate limits',
  client_error_rate_limits: 'rate limits',
  tickets: 'tickets and orders',
  ticket_orders: 'tickets and orders',
  ticket_payment_attempts: 'tickets and orders',
  ticket_inventory: 'tickets and orders',
  ticket_catalog: 'tickets and orders',
  ticket_webhook_deliveries: 'tickets and orders',
  ticket_sync_queue: 'tickets and orders',
  // A new event starts its invoice numbers again at 0001, and the
  // settings hold the past event's bank details.
  invoices: 'invoices and billing',
  invoice_counters: 'invoices and billing',
  invoice_settings: 'invoices and billing',
  session_pitches: 'private pitches',
  sent_emails: 'email logs',
  email_claims: 'email logs',
  email_templates: 'reseeded fresh by init',
  admin_logs: 'operational records',
  system_errors: 'operational records',
  feedback: 'operational records',
  change_requests: 'operational records',
  live_updates: 'operational records',
  announcements: 'operational records',
  announcements_public: 'operational records',
  session_materials: 'operational records',
  session_materials_public: 'operational records',
  media_assets: 'operational records',
  cmsSchedule: 'prior event records',
  cmsOrganizations: 'prior event records',
  cmsTimeline: 'prior event records',
  cmsUpdates: 'prior event records',
  cmsVersionHistory: 'operational records',
  cmsPublishQueue: 'operational records',
  cmsMeta: 'operational records',
  cmsContentSectionLocks: 'operational records',
});

/** `config/*` documents that stay behind, and why. */
const EXCLUDED_CONFIG = Object.freeze({
  bootstrap: 'admin allowlist',
  providers: 'provider selection is Tier A for the new project',
});

// A Storage object, by download URL or by a path in one of the bucket's
// top-level folders (storage.rules). A template block that names one would
// tie the new event to a file it does not hold, or to the source bucket.
const STORAGE_URL_RE = /firebasestorage\.googleapis\.com|storage\.googleapis\.com|\.firebasestorage\.app|\.appspot\.com/i;
const STORAGE_PATH_RE = /^\/?(profile-photos|speaker-photos|cms-images|branding|session-materials|exports)\//;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

function getPath(source, dotted) {
  return dotted.split('.').reduce((node, part) => (node == null ? undefined : node[part]), source);
}

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/** Every dotted leaf path of a plain object; arrays count as leaves. */
function leafPaths(value, prefix = '') {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  const out = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

/** Every string inside a value, however deep. */
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isPlainObject(value)) return Object.values(value).flatMap(strings);
  return [];
}

function referencesStorage(value) {
  return strings(value).some((s) => STORAGE_URL_RE.test(s) || STORAGE_PATH_RE.test(s.trim()));
}

/** JSON-safe copy: Firestore Timestamps and Dates become ISO strings. */
function plain(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

/**
 * The Storage object path a value names, without a host, a bucket or a
 * download token. A download URL's token is a credential: it is never
 * printed or written to a template.
 */
function storageObjectPath(value) {
  const text = String(value || '').trim();
  const fromApi = text.match(/\/o\/([^?#]+)/);
  if (STORAGE_URL_RE.test(text) && fromApi) {
    try {
      return decodeURIComponent(fromApi[1]);
    } catch {
      return fromApi[1];
    }
  }
  if (STORAGE_URL_RE.test(text)) {
    const url = text.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+\//, '');
    return url.replace(/^[^/]+\.(appspot\.com|firebasestorage\.app)\//, '');
  }
  return text.replace(/^\//, '').split(/[?#]/)[0];
}

/** Feature switches that let the public send something in, or show people. */
const PUBLIC_INTAKE_FEATURES = Object.freeze([
  'feedbackInbox', 'changeRequests', 'publicAttendeeProfiles', 'autoApproveTicketHolders', 'webmcpPublic',
  'calendarSync', 'attendeeDirectory',
]);

const EMAIL_IN_TEXT_RE = /mailto:|[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/i;

/** True for a content block init builds from configuration on every apply. */
function isConfigDerived(block) {
  return Boolean(CONFIG_SEEDS[`${block?.section}.${block?.field}`]);
}

/** The placeholder Storage paths init uploads into every project. */
const PLACEHOLDER_PATHS = new Set(Object.keys(BRANDING_ASSETS));

/**
 * The allowlisted event fields. Returns what was kept and what was left
 * out, so the export can inventory it and the apply can refuse it.
 */
function pickEvent(event) {
  const value = {};
  const assets = [];
  for (const field of EVENT_TEMPLATE_FIELDS) {
    const v = getPath(event, field);
    if (v === undefined || v === null) continue;
    if (field === 'seo.defaultOgImagePath' && !PLACEHOLDER_PATHS.has(v)) {
      assets.push({ ref: `config/event.${field}`, value: storageObjectPath(v) });
      continue;
    }
    setPath(value, field, plain(v));
  }
  const kept = new Set(leafPaths(value));
  const dropped = leafPaths(isPlainObject(event) ? event : {})
    .filter((p) => !kept.has(p) && !EVENT_TEMPLATE_FIELDS.some((f) => p === f || p.startsWith(`${f}.`)));
  return { value, dropped, assets };
}

function pickTheme(theme) {
  const value = {};
  const assets = [];
  for (const key of THEME_TEMPLATE_KEYS) {
    if (isPlainObject(theme) && theme[key] !== undefined && theme[key] !== null) value[key] = plain(theme[key]);
  }
  for (const [slot, objectPath] of Object.entries(isPlainObject(theme?.logos) ? theme.logos : {})) {
    const placeholder = Array.isArray(theme.placeholderLogos) && theme.placeholderLogos.includes(slot);
    if (!placeholder) assets.push({ ref: `config/theme.logos.${slot}`, value: storageObjectPath(objectPath) });
  }
  const dropped = Object.keys(isPlainObject(theme) ? theme : {}).filter((k) => !THEME_TEMPLATE_KEYS.includes(k));
  return { value, dropped, assets };
}

function pickFeatures(features) {
  const value = {};
  for (const key of KNOWN_FEATURE_KEYS) {
    if (typeof features?.[key] === 'boolean') value[key] = features[key];
  }
  const dropped = Object.keys(isPlainObject(features) ? features : {})
    .filter((k) => !(KNOWN_FEATURE_KEYS.includes(k) && typeof features[k] === 'boolean'));
  return { value, dropped };
}

function pickBadges(badges) {
  const value = Array.isArray(badges?.categories) ? { categories: plain(badges.categories) } : null;
  const dropped = Object.keys(isPlainObject(badges) ? badges : {}).filter((k) => k !== 'categories');
  return { value, dropped };
}

function pickPage(page) {
  const value = {};
  for (const key of PAGE_TEMPLATE_KEYS) {
    if (page[key] !== undefined) value[key] = plain(page[key]);
  }
  const dropped = Object.keys(page).filter((k) => !PAGE_TEMPLATE_KEYS.includes(k));
  return { value, dropped };
}

/**
 * One content block, reduced to its block type's own fields. Returns null
 * for a block of an unknown type: nothing can say which of its fields are
 * safe.
 */
function pickContent(block) {
  const type = BLOCK_TYPES[block.blockType];
  if (!type) return null;
  const allowed = [...CONTENT_BASE_KEYS, ...type.fields.map((f) => f.id)];
  const value = {};
  for (const key of allowed) {
    if (block[key] !== undefined) value[key] = plain(block[key]);
  }
  const dropped = Object.keys(block).filter((k) => !allowed.includes(k));
  return { value, dropped };
}

/** Sizes of the collections the source project holds. */
async function collectionCounts(db) {
  const names = new Set([...Object.keys(EXCLUDED_REASONS), 'config', 'cmsPages', 'cmsContent']);
  if (typeof db.listCollections === 'function') {
    for (const ref of await db.listCollections()) names.add(ref.id);
  }
  const counts = new Map();
  for (const name of [...names].sort()) {
    const col = db.collection(name);
    let size;
    if (typeof col.count === 'function') {
      const agg = await col.count().get();
      size = agg.data().count;
    } else {
      size = (await col.get()).size;
    }
    counts.set(name, size);
  }
  return counts;
}

/**
 * Read a template from the source project. Read-only: nothing here writes.
 *
 * @param {{ db: object, projectId: string, pageIds?: string[]|null, now?: () => number }} args
 * @returns {Promise<{ ok: boolean, errors: string[], template: object }>}
 */
async function exportTemplate({ db, projectId, pageIds = null, now = Date.now }) {
  const errors = [];
  const configSnap = await db.collection('config').get();
  const config = {};
  for (const doc of configSnap.docs) config[doc.id] = doc.data();
  if (!config.event) {
    return { ok: false, errors: ['config/event is missing: this project was never initialized'], template: null };
  }

  const assets = [];
  const warnings = [];
  const event = pickEvent(config.event);
  const theme = pickTheme(config.theme || {});
  const features = pickFeatures(config.features || {});
  const badges = pickBadges(config.badges || {});
  assets.push(...event.assets, ...theme.assets);
  // A carried contact address may belong to someone who has left.
  for (const field of ['supportEmail', 'conductEmail']) {
    if (typeof event.value.legal?.[field] === 'string' && event.value.legal[field]) {
      warnings.push(`config/event.legal.${field}: carried contact address; confirm it is still right`);
    }
  }

  const pagesSnap = await db.collection('cmsPages').get();
  const allPages = pagesSnap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  const wanted = pageIds && pageIds.length > 0 ? new Set(pageIds) : null;
  if (wanted) {
    for (const id of wanted) {
      if (!allPages.some((p) => p.id === id)) errors.push(`--page ${id}: no live page with that id`);
    }
  }
  const pages = [];
  for (const page of allPages.filter((p) => !wanted || wanted.has(p.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    const picked = pickPage(page).value;
    const verdict = validatePageDoc(picked);
    if (!verdict.ok) {
      warnings.push(`cmsPages/${page.id}: left out, it fails page validation (${verdict.errors.join('; ')})`);
      continue;
    }
    pages.push(picked);
  }

  const sectionOwner = new Map();
  for (const page of pages) {
    for (const section of page.sections || []) sectionOwner.set(section.id, page.id);
  }

  const sourceNames = [config.event.name, config.event.shortName].filter((s) => typeof s === 'string' && s.trim());
  const sourceYears = [...new Set((config.event.days || []).map((d) => String(d?.date || '').slice(0, 4)).filter(Boolean))];

  const contentSnap = await db.collection('cmsContent').get();
  const content = [];
  for (const doc of contentSnap.docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const data = { ...doc.data(), id: doc.id };
    const owner = sectionOwner.get(data.section);
    if (!owner || LEGAL_PAGE_IDS.includes(owner)) continue;
    const picked = pickContent(data);
    if (!picked) {
      warnings.push(`cmsContent/${doc.id}: left out, unknown block type ${JSON.stringify(data.blockType)}`);
      continue;
    }
    // A block init builds from configuration (the title, the dates, the
    // venue, the contact links) is built again from the new event's
    // settings on every apply. Carrying it could only carry old values.
    if (isConfigDerived(data)) continue;
    if (referencesStorage(picked.value)) {
      // A block that shows a stored file stays behind; the operator copies
      // the file into the new bucket and adds the block again there.
      const named = strings(picked.value).find((t) => STORAGE_URL_RE.test(t) || STORAGE_PATH_RE.test(t.trim()));
      assets.push({ ref: `cmsContent/${doc.id}`, value: storageObjectPath(named) });
      continue;
    }
    // Review lines name the block and the reason, never the value: the
    // inventory is printed and shared, and the value may be personal.
    const text = strings(picked.value).join('\n');
    const mentions = [...sourceNames, ...sourceYears].filter((t) => text.includes(t));
    if (mentions.length > 0) {
      warnings.push(`cmsContent/${doc.id}: mentions ${mentions.map((m) => JSON.stringify(m)).join(', ')}; review before reuse`);
    }
    if (EMAIL_IN_TEXT_RE.test(text)) {
      warnings.push(`cmsContent/${doc.id}: names an email address; confirm it is still right`);
    }
    if (picked.value.blockType === 'quote') {
      warnings.push(`cmsContent/${doc.id}: a quote names a person; confirm they agree to its reuse`);
    }
    content.push(picked.value);
  }

  const counts = await collectionCounts(db);
  const included = [];
  const excluded = [];
  for (const docId of Object.keys(config).sort()) {
    const path = `config/${docId}`;
    if (INCLUDED[path]) {
      included.push({ path, detail: INCLUDED[path] });
    } else {
      excluded.push({ path, count: 1, reason: EXCLUDED_CONFIG[docId] || 'not on the template allowlist' });
    }
  }
  included.push({ path: 'cmsPages', count: pages.length, detail: INCLUDED.cmsPages });
  included.push({ path: 'cmsContent', count: content.length, detail: INCLUDED.cmsContent });
  for (const [name, count] of counts) {
    if (name === 'config' || name === 'cmsPages' || name === 'cmsContent') continue;
    excluded.push({ path: name, count, reason: EXCLUDED_REASONS[name] || 'not on the template allowlist' });
  }
  const leftOut = {
    'config/event': event.dropped,
    'config/theme': theme.dropped,
  };

  return {
    ok: errors.length === 0,
    errors,
    template: {
      kind: TEMPLATE_KIND,
      version: TEMPLATE_VERSION,
      source: {
        projectId,
        eventName: config.event.name || '',
        days: (config.event.days || []).map((d) => d?.date).filter(Boolean),
        exportedAt: new Date(now()).toISOString(),
      },
      answers: {
        event: event.value,
        theme: theme.value,
        features: features.value,
        ...(badges.value ? { badges: badges.value } : {}),
      },
      pages,
      content,
      inventory: { included, excluded, leftOut, assets, warnings },
    },
  };
}

/** The dry-run inventory as text, one line per row. */
function formatInventory(template) {
  const inventory = {
    included: [], excluded: [], leftOut: {}, assets: [], warnings: [],
    ...(isPlainObject(template.inventory) ? template.inventory : {}),
  };
  const lines = [];
  lines.push(`Template from ${template.source.projectId} (${template.source.eventName || 'unnamed event'})`);
  lines.push('');
  lines.push('Included (review every item before you use it):');
  for (const row of inventory.included) {
    lines.push(`  + ${row.path}${row.count !== undefined ? ` (${row.count})` : ''}: ${row.detail}`);
  }
  lines.push('');
  lines.push('Excluded:');
  for (const row of inventory.excluded) {
    lines.push(`  - ${row.path} (${row.count}): ${row.reason}`);
  }
  for (const [path, fields] of Object.entries(inventory.leftOut)) {
    if (fields.length > 0) lines.push(`  - ${path} fields: ${fields.join(', ')}`);
  }
  const features = isPlainObject(template.answers?.features) ? template.answers.features : {};
  if (Object.keys(features).length > 0) {
    lines.push('');
    lines.push('Feature switches carried:');
    for (const [key, on] of Object.entries(features)) {
      const intake = on && PUBLIC_INTAKE_FEATURES.includes(key) ? ' (public intake: review)' : '';
      lines.push(`  ${key}: ${on ? 'on' : 'off'}${intake}`);
    }
  }
  if (inventory.assets.length > 0) {
    lines.push('');
    lines.push('Stored files to copy into the new project by hand (left out of the template):');
    for (const a of inventory.assets) lines.push(`  * ${a.ref}: ${a.value}`);
  }
  if (inventory.warnings.length > 0) {
    lines.push('');
    lines.push('Review:');
    for (const w of inventory.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join('\n');
}

/**
 * Parse and re-check a template file. The allowlist is applied again here,
 * so a template edited by hand to carry anything else is refused.
 *
 * @param {string} text
 * @returns {{ ok: boolean, errors: string[], template: object|null }}
 */
function parseTemplateFile(text) {
  let t;
  try {
    t = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`template is not valid JSON: ${err.message}`], template: null };
  }
  const errors = [];
  if (!isPlainObject(t) || t.kind !== TEMPLATE_KIND) {
    return { ok: false, errors: [`template: kind must be "${TEMPLATE_KIND}"`], template: null };
  }
  if (t.version !== TEMPLATE_VERSION) errors.push(`template: version must be ${TEMPLATE_VERSION}`);
  for (const key of Object.keys(t)) {
    if (!['kind', 'version', 'source', 'answers', 'pages', 'content', 'inventory'].includes(key)) {
      errors.push(`template.${key}: not on the template allowlist`);
    }
  }
  if (!isPlainObject(t.source) || typeof t.source.projectId !== 'string' || !t.source.projectId) {
    errors.push('template.source.projectId: required');
  }
  if (!Array.isArray(t.source?.days) || t.source.days.length === 0
    || !t.source.days.every((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    errors.push('template.source.days: the source event has no dates; a template needs them to check the new dates');
  }
  errors.push(...inventoryErrors(t.inventory));

  const answers = isPlainObject(t.answers) ? t.answers : {};
  for (const key of Object.keys(answers)) {
    if (!['event', 'theme', 'features', 'badges'].includes(key)) {
      errors.push(`template.answers.${key}: not on the template allowlist`);
    }
  }
  const eventPaths = leafPaths(answers.event || {});
  for (const p of eventPaths) {
    if (!EVENT_TEMPLATE_FIELDS.some((f) => p === f || p.startsWith(`${f}.`))) {
      errors.push(`template.answers.event.${p}: not on the template allowlist`);
    }
  }
  for (const key of pickTheme(answers.theme || {}).dropped) {
    errors.push(`template.answers.theme.${key}: not on the template allowlist`);
  }
  for (const key of pickFeatures(answers.features || {}).dropped) {
    errors.push(`template.answers.features.${key}: not on the template allowlist`);
  }
  for (const key of pickBadges(answers.badges || {}).dropped) {
    errors.push(`template.answers.badges.${key}: not on the template allowlist`);
  }

  const pages = Array.isArray(t.pages) ? t.pages : [];
  const sectionOwner = new Map();
  for (const [i, page] of pages.entries()) {
    if (!isPlainObject(page)) {
      errors.push(`template.pages[${i}]: must be an object`);
      continue;
    }
    const verdict = validatePageDoc(page);
    if (!verdict.ok) errors.push(...verdict.errors.map((e) => `template.pages[${i}] (${page.id}): ${e}`));
    errors.push(...systemPageErrors(page).map((e) => `template.pages[${i}] (${page.id}): ${e}`));
    for (const section of Array.isArray(page.sections) ? page.sections : []) sectionOwner.set(section?.id, page.id);
  }
  errors.push(...pageSetErrors(pages.filter(isPlainObject)).map((e) => `template.pages: ${e}`));
  // The content editor's own write rules (cms/content.cjs): rich text is
  // cleaned by the same sanitizer, then the block must meet its type's
  // required fields and the sponsor package limit. A hand-edited file gets
  // no shortcut past them.
  const { sanitizeRichTextFields } = require('../../functions/src/cms/richText.cjs');
  const { internals: { checkBlockContract } } = require('../../functions/src/cms/content.cjs');
  const content = (Array.isArray(t.content) ? t.content : [])
    .map((block) => (isPlainObject(block) ? sanitizeRichTextFields(block) : block));
  for (const [i, block] of content.entries()) {
    const at = `template.content[${i}] (${block?.id})`;
    const picked = isPlainObject(block) ? pickContent(block) : null;
    if (!picked) {
      errors.push(`${at}: unknown block type`);
      continue;
    }
    for (const key of picked.dropped) errors.push(`${at}.${key}: not on the template allowlist`);
    const contract = checkBlockContract({ collection: 'cmsContent', fields: block });
    if (!contract.ok) errors.push(...contract.message.split('; ').map((e) => `${at}: ${e}`));
    if (typeof block.id !== 'string' || block.id !== `${block.section}__${block.field}`) {
      errors.push(`${at}: id must be <section>__<field>`);
    }
    if (isConfigDerived(block)) {
      errors.push(`${at}: built from the new event's settings on apply; leave it out of the template`);
    }
    const owner = sectionOwner.get(block.section);
    if (!owner) errors.push(`${at}: section ${block.section} is on no template page`);
    else if (LEGAL_PAGE_IDS.includes(owner)) errors.push(`${at}: legal page content is reseeded, not reused`);
    if (referencesStorage(block)) errors.push(`${at}: names a stored file; copy the file and add the block by hand`);
  }
  return { ok: errors.length === 0, errors, template: errors.length === 0 ? { ...t, answers, pages, content } : null };
}

const INVENTORY_ROW_KEYS = Object.freeze({
  included: { path: 'string', detail: 'string', count: 'number?' },
  excluded: { path: 'string', reason: 'string', count: 'number' },
  assets: { ref: 'string', value: 'string' },
});

/**
 * The inventory travels in the file and is printed at apply time, so it is
 * held to a shape too: known keys, known row fields, plain values.
 *
 * @param {*} inventory
 * @returns {string[]}
 */
function inventoryErrors(inventory) {
  if (inventory === undefined) return [];
  if (!isPlainObject(inventory)) return ['template.inventory: must be an object'];
  const errors = [];
  for (const key of Object.keys(inventory)) {
    if (!['included', 'excluded', 'leftOut', 'assets', 'warnings'].includes(key)) {
      errors.push(`template.inventory.${key}: not on the template allowlist`);
    }
  }
  for (const [list, shape] of Object.entries(INVENTORY_ROW_KEYS)) {
    if (inventory[list] === undefined) continue;
    if (!Array.isArray(inventory[list])) {
      errors.push(`template.inventory.${list}: must be an array`);
      continue;
    }
    inventory[list].forEach((row, i) => {
      const at = `template.inventory.${list}[${i}]`;
      if (!isPlainObject(row)) {
        errors.push(`${at}: must be an object`);
        return;
      }
      for (const key of Object.keys(row)) {
        if (!(key in shape)) errors.push(`${at}.${key}: not on the template allowlist`);
      }
      for (const [key, type] of Object.entries(shape)) {
        const optional = type.endsWith('?');
        if (optional && row[key] === undefined) continue;
        if (typeof row[key] !== type.replace('?', '')) errors.push(`${at}.${key}: must be a ${type.replace('?', '')}`);
      }
    });
  }
  if (inventory.leftOut !== undefined) {
    if (!isPlainObject(inventory.leftOut)) {
      errors.push('template.inventory.leftOut: must be an object');
    } else {
      for (const [key, list] of Object.entries(inventory.leftOut)) {
        if (!Array.isArray(list) || !list.every((v) => typeof v === 'string')) {
          errors.push(`template.inventory.leftOut.${key}: must be a list of field names`);
        }
      }
    }
  }
  if (inventory.warnings !== undefined) {
    if (!Array.isArray(inventory.warnings)) {
      errors.push('template.inventory.warnings: must be an array');
    } else {
      inventory.warnings.forEach((w, i) => {
        if (typeof w !== 'string') errors.push(`template.inventory.warnings[${i}]: must be a string`);
      });
    }
  }
  return errors;
}

/** Default system page id → the route it owns. */
function systemRoutes() {
  return new Map(defaultPages().filter((p) => p.systemPage === true).map((p) => [p.id, p.path]));
}

/**
 * A system page owns a dedicated route, so a file may only name the
 * default system pages as system pages, each at its own route. Every other
 * page is a generic page, and validatePageDoc keeps it off reserved routes.
 *
 * @param {object} page
 * @returns {string[]}
 */
function systemPageErrors(page) {
  const routes = systemRoutes();
  if (routes.has(page.id)) {
    const route = routes.get(page.id);
    if (page.systemPage !== true || page.path !== route) {
      return [`${page.id} is a system page and must stay at ${route} with systemPage true`];
    }
    return [];
  }
  if (page.systemPage === true) {
    return [`${page.id}: systemPage is only for the default system pages (${[...routes.keys()].join(', ')})`];
  }
  return [];
}

/**
 * Ids, paths and section ids must each belong to one page in a set.
 *
 * @param {object[]} pages
 * @returns {string[]}
 */
function pageSetErrors(pages) {
  const errors = [];
  for (const [label, values] of [
    ['id', pages.map((p) => p.id)],
    ['path', pages.map((p) => p.path)],
    ['section', pages.flatMap((p) => (Array.isArray(p.sections) ? p.sections : []).map((sec) => sec?.id))],
  ]) {
    const seen = new Set();
    const repeated = new Set();
    for (const v of values) {
      if (seen.has(v)) repeated.add(v);
      seen.add(v);
    }
    for (const v of repeated) errors.push(`${label} ${v} is used by more than one page`);
  }
  return errors;
}

function deepMerge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

/** Template answers under the new event's own answers: the answers file wins. */
function mergeTemplateAnswers(template, answers) {
  return deepMerge(template.answers, answers);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The gate before a template is applied: new dates and a named owner who
 * is one of the new event's operators.
 *
 * @param {{ template: object, answers: object, adminEmails: string[] }} args
 * @returns {string[]} errors; empty when the apply may go on
 */
function templateApplyErrors({ template, answers, adminEmails }) {
  const errors = [];
  const days = Array.isArray(answers?.event?.days) ? answers.event.days : [];
  if (days.length === 0) {
    errors.push('event.days: a template needs the new event\'s own dates in the answers file');
  }
  // ISO dates compare as strings. Every new date must come after the
  // source event's last day: a template makes a later event, never a copy
  // of the same one.
  const lastSourceDay = [...template.source.days].sort().at(-1);
  const early = days.map((d) => d?.date).filter((date) => typeof date !== 'string' || date <= lastSourceDay);
  if (early.length > 0) {
    errors.push(`event.days: ${early.join(', ')} ${early.length === 1 ? 'is' : 'are'} not later than the source event (${lastSourceDay}); give the new event its own dates`);
  }
  const owner = answers?.owner;
  const name = typeof owner?.name === 'string' ? owner.name.trim() : '';
  const email = typeof owner?.email === 'string' ? owner.email.trim().toLowerCase() : '';
  if (!name) errors.push('owner.name: a template needs a named owner for the new event');
  if (!EMAIL_RE.test(email)) {
    errors.push('owner.email: a template needs the owner\'s email address');
  } else if (!adminEmails.includes(email)) {
    errors.push(`owner.email: ${email} must also be an operator (--admin or adminEmails)`);
  }
  return errors;
}

/**
 * The page set a template apply seeds: every template page, then each
 * default page the template does not replace and does not collide with.
 *
 * @param {{ templatePages: object[], defaults: object[] }} args
 * @returns {object[]}
 */
function mergeTemplatePages({ templatePages, defaults }) {
  const ids = new Set(templatePages.map((p) => p.id));
  const paths = new Set(templatePages.map((p) => p.path));
  const sections = new Set(templatePages.flatMap((p) => (p.sections || []).map((s) => s.id)));
  const kept = defaults.filter((p) => !ids.has(p.id)
    && !paths.has(p.path)
    && !(p.sections || []).some((s) => sections.has(s.id)));
  return [...templatePages, ...kept];
}

/**
 * The content a template apply seeds. Legal pages and default pages keep
 * the fresh seed. A template page takes the template's own blocks, except
 * a block init derives from configuration (the title, the dates), which is
 * built again from the NEW event's configuration.
 *
 * @param {{ generated: object[], template: object, configDerived?: object[],
 *           seededAt: string }} args
 *   `configDerived` holds the settings-built blocks for every section of
 *   the merged page set, built from the new configuration.
 * @returns {object[]}
 */
function mergeTemplateContent({ generated, template, configDerived = [], seededAt }) {
  const templateSections = new Set();
  for (const page of template.pages) {
    if (LEGAL_PAGE_IDS.includes(page.id)) continue;
    for (const section of page.sections || []) templateSections.add(section.id);
  }
  const fresh = generated.filter((doc) => !templateSections.has(doc.section) || isConfigDerived(doc));
  const freshIds = new Set(fresh.map((doc) => doc.id));
  // A settings-built block for a section the merged pages hold is always
  // built fresh, even when the template page no longer lists the field.
  for (const doc of configDerived) {
    if (!freshIds.has(doc.id)) {
      fresh.push(doc);
      freshIds.add(doc.id);
    }
  }
  const reused = template.content
    .filter((doc) => !freshIds.has(doc.id) && !isConfigDerived(doc))
    .map((doc) => ({ ...doc, seeded: true, seededAt }));
  return [...fresh, ...reused];
}

/**
 * The extra readiness row a templated event carries: its own dates and a
 * named owner who is still an operator.
 *
 * @param {{ template?: object|null, event?: object|null, bootstrap?: object|null }} config
 * @returns {Array<object>} zero rows for a project not made from a template
 */
function templateReadinessRows({ template, event, bootstrap }) {
  if (!template) return [];
  const old = new Set(Array.isArray(template.sourceDays) ? template.sourceDays : []);
  const days = Array.isArray(event?.days) ? event.days.map((d) => d?.date).filter(Boolean) : [];
  const admins = Array.isArray(bootstrap?.adminEmails) ? bootstrap.adminEmails : [];
  const owner = template.owner || {};
  const problems = [];
  if (template.status !== 'applied') problems.push('the template apply did not finish; run the same command again');
  const lastSourceDay = [...old].sort().at(-1) || '';
  if (days.length === 0) problems.push('no event dates');
  if (days.some((d) => d <= lastSourceDay)) problems.push(`dates are not later than ${template.sourceProjectId}`);
  if (!owner.name || !owner.email) problems.push('no named owner');
  else if (!admins.includes(owner.email)) problems.push(`owner ${owner.email} is not an operator`);
  return [{
    id: 'template',
    label: 'Template reuse',
    ok: problems.length === 0,
    detail: problems.length === 0
      ? `from ${template.sourceProjectId}; owner ${owner.name} <${owner.email}>`
      : problems.join('; '),
    remedy: 'Set this event\'s own dates in admin Event settings, and keep the named owner an operator (Settings → Access).',
  }];
}

module.exports = {
  TEMPLATE_KIND,
  TEMPLATE_VERSION,
  EVENT_TEMPLATE_FIELDS,
  THEME_TEMPLATE_KEYS,
  EXCLUDED_REASONS,
  EXCLUDED_CONFIG,
  exportTemplate,
  formatInventory,
  parseTemplateFile,
  mergeTemplateAnswers,
  templateApplyErrors,
  mergeTemplatePages,
  mergeTemplateContent,
  templateReadinessRows,
  pageSetErrors,
  isConfigDerived,
  internals: { pickEvent, pickTheme, pickContent, referencesStorage, leafPaths, storageObjectPath, systemPageErrors },
};
