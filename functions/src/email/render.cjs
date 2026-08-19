'use strict';

/**
 * Template renderer (spec §6.1–6.2).
 *
 * Escaping rule, mechanical and enforced by the token name: a token whose
 * name ends in `_html` is substituted raw into the html body and stripped
 * to plain text for the text body; every other token is HTML-escaped in
 * html and substituted raw into text.
 *
 * Invariant: no user-supplied value may ever populate an `_html` token.
 * `_html` values are accepted only from HTML_TOKEN_RESOLVERS below, which
 * reads config — never from the per-send tokenValues argument — so a call
 * site cannot pass one even by mistake.
 */

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
// Any {{...}} construct, however malformed — validation flags the ones the
// token grammar above would silently pass over ({{support-email}},
// {{profile.url}}), which substitution would otherwise deliver as literal
// braces.
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;
const TOKEN_NAME_RE = /^[a-z0-9_]+$/i;

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip trusted markup down to text: <br> and block closers become
 * newlines, remaining tags drop, basic entities decode.
 * @param {string} html
 */
function stripHtmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @param {object|null|undefined} social config/event.social */
function buildSocialLinksHtml(social) {
  const handles = Array.isArray(social?.handles) ? social.handles : [];
  const links = handles
    .filter((h) => h && typeof h.url === 'string' && typeof h.platform === 'string')
    .map((h) => `<a href="${escapeHtml(h.url)}">${escapeHtml(h.platform)}</a>`);
  return links.join(' &middot; ');
}

/**
 * The fixed resolver map for `_html` tokens (spec §6.1). Values come only
 * from config (admin-authored, rules-gated) or code constants.
 * @type {Record<string, (config: object) => string>}
 */
const HTML_TOKEN_RESOLVERS = {
  postal_address_html: (config) => config?.event?.legal?.postalAddressHtml || '',
  social_links_html: (config) => buildSocialLinksHtml(config?.event?.social),
  next_steps_html: (config) => {
    const site = siteUrl(config);
    const steps = [
      `<li><a href="${escapeHtml(`${site}/schedule`)}">Browse the schedule</a></li>`,
      `<li><a href="${escapeHtml(`${site}/profile`)}">Complete your profile</a></li>`,
    ];
    return `<ul>${steps.join('')}</ul>`;
  },
};

/** @param {object} config */
function siteUrl(config) {
  const url = config?.tierA?.publicUrl || '';
  return url.replace(/\/+$/, '');
}

/** Format days[] into a human range like "2027-05-13 to 2027-05-14". */
function formatEventDates(event) {
  const days = Array.isArray(event?.days) ? event.days : [];
  if (days.length === 0) return '';
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';
  if (!first) return '';
  return first === last ? first : `${first} to ${last}`;
}

/** @param {object} venue config/event.venue */
function formatVenueAddress(venue) {
  if (!venue || typeof venue !== 'object') return '';
  return [
    venue.addressLine1,
    venue.addressLine2,
    [venue.city, venue.region, venue.postalCode].filter(Boolean).join(', '),
    venue.country,
  ]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(', ');
}

/**
 * Global token values available to every template (spec §6.2), from the
 * loaded config (core/config.cjs shape: { event, theme, tierA, ... }).
 *
 * `_html` globals are NOT produced here — they resolve through
 * HTML_TOKEN_RESOLVERS at substitution time.
 *
 * @param {object} config
 * @param {{ now?: () => Date }} [opts]
 * @returns {Record<string, string>}
 */
function buildGlobalTokens(config, { now = () => new Date() } = {}) {
  const event = config?.event || {};
  const theme = config?.theme || {};
  const site = siteUrl(config);
  return {
    event_name: event.name || '',
    event_short_name: event.shortName || '',
    event_tagline: event.tagline || '',
    event_dates: formatEventDates(event),
    event_timezone: event.timezone || '',
    venue_name: event.venue?.name || '',
    venue_address: formatVenueAddress(event.venue),
    venue_map_url: event.venue?.mapUrl || '',
    site_url: site,
    login_url: site ? `${site}/login` : '',
    schedule_url: site ? `${site}/schedule` : '',
    support_email: event.legal?.supportEmail || '',
    sender_name: event.sender?.name || '',
    sender_email: event.sender?.email || '',
    operator_name: event.legal?.operatorName || '',
    brand_primary: theme.colors?.primary || '',
    brand_ink: theme.colors?.ink || '',
    logo_url: theme.logoUrl || '',
    current_year: String(now().getFullYear()),
  };
}

/** Unique token names referenced in a body. @param {string} body */
function referencedTokens(body) {
  const names = new Set();
  for (const match of String(body).matchAll(TOKEN_RE)) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

/**
 * The two token checks (spec §6.1), run at render time against the
 * effective bodies and at save time by saveEmailTemplate.
 *
 * @param {{ tokens: string[], requiredTokens: string[] }} template
 * @param {{ subject: string, html: string, text: string }} candidate
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateTemplateBody(template, candidate) {
  const errors = [];
  const declared = new Set(template.tokens.map((t) => t.toLowerCase()));

  for (const [field, body] of Object.entries(candidate)) {
    for (const name of referencedTokens(body || '')) {
      if (!declared.has(name)) {
        errors.push(`${field}: unknown token {{${name}}}`);
      }
    }
    for (const match of String(body || '').matchAll(PLACEHOLDER_RE)) {
      if (!TOKEN_NAME_RE.test(match[1].trim())) {
        errors.push(`${field}: malformed placeholder {{${match[1]}}}`);
      }
    }
  }

  // Required tokens must be referenced in every body that is sent — a
  // required token present in html but missing from text still produces a
  // useless mail for plain-text readers.
  for (const required of template.requiredTokens) {
    for (const field of ['html', 'text']) {
      if (!referencedTokens(candidate[field] || '').has(required.toLowerCase())) {
        errors.push(`${field}: missing required token {{${required}}}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Substitute tokens into one body.
 *
 * @param {string} body
 * @param {'html'|'text'} kind subject counts as 'text'
 * @param {Record<string, string>} values plain-token values (per-send merged
 *   over globals)
 * @param {object} config for `_html` resolvers
 * @param {string[]} warnings mutated: missing-value warnings
 */
function substitute(body, kind, values, config, warnings) {
  return String(body).replace(TOKEN_RE, (_, rawName) => {
    const name = rawName.toLowerCase();
    if (name.endsWith('_html')) {
      const resolver = HTML_TOKEN_RESOLVERS[name];
      if (!resolver) {
        warnings.push(`no resolver for {{${name}}}; substituted empty`);
        return '';
      }
      const value = resolver(config) || '';
      return kind === 'html' ? value : stripHtmlToText(value);
    }
    if (!(name in values) || values[name] == null) {
      warnings.push(`missing value for {{${name}}}; substituted empty`);
      return '';
    }
    const value = String(values[name]);
    return kind === 'html' ? escapeHtml(value) : value;
  });
}

/**
 * Render a template with an optional Firestore override.
 *
 * A failed override check falls back to the code default for this render
 * (spec §6.1 step 4) and reports the errors so the caller can log a
 * system_errors row and fire an OperatorEvent — the client's mail keeps
 * working on the shipped copy.
 *
 * @param {{ template: object, override?: object|null,
 *           tokenValues?: Record<string, string>, config: object,
 *           now?: () => Date }} args
 * @returns {{ subject: string, html: string, text: string,
 *             usedFallback: boolean, overrideErrors: string[],
 *             warnings: string[] }}
 */
function render({ template, override = null, tokenValues = {}, config, now }) {
  const warnings = [];
  let overrideErrors = [];
  let usedFallback = false;

  let effective = {
    subject: template.subject,
    html: template.html,
    text: template.text,
  };

  if (override) {
    const candidate = {
      subject: typeof override.subject === 'string' ? override.subject : template.subject,
      html: typeof override.html === 'string' ? override.html : template.html,
      text: typeof override.text === 'string' ? override.text : template.text,
    };
    const check = validateTemplateBody(template, candidate);
    if (check.ok) {
      effective = candidate;
    } else {
      usedFallback = true;
      overrideErrors = check.errors;
    }
  }

  // Reject any attempt to pass an `_html` value per-send (invariant §6.1).
  const values = { ...buildGlobalTokens(config, { now: now || (() => new Date()) }) };
  for (const [key, value] of Object.entries(tokenValues)) {
    if (key.toLowerCase().endsWith('_html')) {
      warnings.push(`ignored per-send value for {{${key}}}: _html tokens resolve from config only`);
      continue;
    }
    values[key.toLowerCase()] = value;
  }

  return {
    subject: substitute(effective.subject, 'text', values, config, warnings),
    html: substitute(effective.html, 'html', values, config, warnings),
    text: substitute(effective.text, 'text', values, config, warnings),
    // The template's storage policy travels with the rendered result so
    // spreading it into send() suppresses body storage without every call
    // site re-attaching the flag — an auth.otp render must never persist
    // the code in admin-readable sent_emails (spec §3.1, §6.1).
    storeRendered: template.storeRendered !== false,
    // Footer flags are DERIVED per body from the effective (possibly
    // overridden) source, never assumed: a valid override that drops
    // {{postal_address_html}} must not tell the send core the footer is
    // already there (spec §3.1 — footer resolution is a core duty).
    hasLegalFooterHtml: referencedTokens(effective.html).has('postal_address_html'),
    hasLegalFooterText: referencedTokens(effective.text).has('postal_address_html'),
    usedFallback,
    overrideErrors,
    warnings,
  };
}

/**
 * Every global token name (spec §6.2) — the vocabulary templates declare so
 * overrides may reference any of them without tripping the unknown-token
 * check. Derived from buildGlobalTokens plus the global `_html` resolvers.
 */
const GLOBAL_TOKEN_NAMES = Object.freeze([
  ...Object.keys(buildGlobalTokens({})),
  'postal_address_html',
  'social_links_html',
]);

module.exports = {
  render,
  validateTemplateBody,
  buildGlobalTokens,
  GLOBAL_TOKEN_NAMES,
  internals: {
    escapeHtml,
    stripHtmlToText,
    referencedTokens,
    substitute,
    HTML_TOKEN_RESOLVERS,
    buildSocialLinksHtml,
    formatEventDates,
    formatVenueAddress,
  },
};
