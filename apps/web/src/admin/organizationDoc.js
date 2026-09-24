// cmsOrganizations helpers for the organizations list and editor (issue
// #192). An organization is a record under the two-revision publish model
// (functions/src/cms/store.cjs), written through the generic content
// endpoints, whose organization seam (functions/src/cms/organizations.cjs)
// checks each field's type at the save. This module gives the editor its
// form shape and the same limits, so a field names its problem before the
// server has to.
import { generateSlug } from 'shared/slug';
import { isSafeUrl } from 'shared/urlSafety';
import { recordStateOf } from './recordState.js';

/**
 * The longest value each editor field may hold. Mirrors ORGANIZATION_LIMITS
 * in functions/src/cms/organizations.cjs; organizationDoc.test.js imports
 * that object and holds the two together.
 */
export const ORGANIZATION_FIELD_LIMITS = Object.freeze({
  slug: 80,
  name: 120,
  tier: 60,
  url: 2000,
  description: 500,
});

/** A page address: lowercase words joined by single hyphens (the speaker slug's shape). */
export const ORGANIZATION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The sort the sponsors wall draws in: `order`, then id (components/SponsorWall.jsx). */
function orderOf(organization) {
  return Number.isFinite(organization?.order) ? organization.order : 0;
}

/**
 * One row per organization, from its live and draft revisions, in the order
 * the sponsors page draws them. `current` is the draft where there is one.
 *
 * @param {Array<object>|null} liveDocs
 * @param {Array<object>|null} draftDocs
 * @returns {Array<{ id: string, live: object|null, draft: object|null, current: object, state: object }>}
 */
export function mergeOrganizationRevisions(liveDocs, draftDocs) {
  const liveById = new Map((liveDocs ?? []).map((doc) => [doc.id, doc]));
  const draftById = new Map((draftDocs ?? []).map((doc) => [doc.id, doc]));
  return [...new Set([...liveById.keys(), ...draftById.keys()])]
    .map((id) => {
      const live = liveById.get(id) ?? null;
      const draft = draftById.get(id) ?? null;
      return { id, live, draft, current: draft ?? live, state: recordStateOf({ live, draft }) };
    })
    .sort((a, b) => orderOf(a.current) - orderOf(b.current) || a.id.localeCompare(b.id));
}

/**
 * The page address a name suggests: the shared slug rule, cut to the limit
 * without leaving a hyphen at the end.
 *
 * @param {string} name
 * @returns {string}
 */
export function organizationSlugFromName(name) {
  return generateSlug(String(name ?? ''))
    .slice(0, ORGANIZATION_FIELD_LIMITS.slug)
    .replace(/-+$/, '');
}

/** The distinct tiers the organizations use, for the tier field's suggestions. */
export function tiersInUse(rows) {
  const tiers = new Set();
  for (const row of rows ?? []) {
    const tier = row?.current?.tier;
    if (typeof tier === 'string' && tier.trim()) tiers.add(tier.trim());
  }
  return [...tiers].sort((a, b) => a.localeCompare(b));
}

/** The order a new organization takes: one after the last, so it joins the end of the wall. */
export function nextOrganizationOrder(rows) {
  const orders = (rows ?? [])
    .map((row) => row?.current?.order)
    .filter((order) => Number.isFinite(order));
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

const textOrNull = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

/**
 * The order as the form holds it: blank is none, a number is a number, and
 * anything else goes as typed so the server's message names it.
 */
function orderValue(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

/**
 * The `fields` cmsCreateContent and cmsUpdateContent receive. The six
 * fields the editor shows and nothing else, so a profile field a script
 * wrote (bio, supportDescription, readMorePath) is kept by the merge.
 * The server drops the seed's bookkeeping on every admin write, so an
 * edited demo sponsor is the client's from then on.
 *
 * @param {object} form
 * @returns {object}
 */
export function organizationFields(form) {
  return {
    name: String(form.name ?? '').trim(),
    tier: textOrNull(form.tier),
    order: orderValue(form.order),
    logoPath: textOrNull(form.logoPath),
    url: textOrNull(form.url),
    description: textOrNull(form.description),
  };
}

const tooLong = (field) => `Use ${ORGANIZATION_FIELD_LIMITS[field]} characters or fewer.`;

/**
 * The editor's own checks, field by field. The server repeats each one;
 * these name the problem while the operator is still looking at the field.
 *
 * @param {object} form
 * @param {{ mode: 'create'|'edit' }} options
 * @returns {Map<string, string>} field → message
 */
export function validateOrganizationForm(form, { mode }) {
  const errors = new Map();
  if (mode === 'create') {
    const slug = String(form.slug ?? '');
    if (!slug) errors.set('slug', 'Enter a page address.');
    else if (slug.length > ORGANIZATION_FIELD_LIMITS.slug || !ORGANIZATION_SLUG_RE.test(slug)) {
      errors.set('slug', 'Use lowercase letters, digits, and single hyphens, up to 80 characters.');
    }
  }
  const name = String(form.name ?? '').trim();
  if (!name) errors.set('name', 'Enter the organization’s name.');
  else if (name.length > ORGANIZATION_FIELD_LIMITS.name) errors.set('name', tooLong('name'));
  if (String(form.tier ?? '').trim().length > ORGANIZATION_FIELD_LIMITS.tier) {
    errors.set('tier', tooLong('tier'));
  }
  if (typeof orderValue(form.order) === 'string') errors.set('order', 'Enter a number.');
  const url = String(form.url ?? '').trim();
  if (url && !isSafeUrl(url)) errors.set('url', 'Enter a link that starts with http:// or https://.');
  else if (url.length > ORGANIZATION_FIELD_LIMITS.url) errors.set('url', tooLong('url'));
  if (String(form.description ?? '').trim().length > ORGANIZATION_FIELD_LIMITS.description) {
    errors.set('description', tooLong('description'));
  }
  return errors;
}
