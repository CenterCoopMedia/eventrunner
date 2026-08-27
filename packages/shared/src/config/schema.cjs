'use strict';

/**
 * Validation for the Tier B runtime config documents (spec §2.2).
 *
 * Used by the validated admin config writers (spec §1.3) and by
 * init-event.cjs before any seed write. Each validator is total: it never
 * throws, and returns `{ ok, errors }` where every error names the
 * offending field.
 */

const { MAX_TOTAL_BADGES } = require('../badges.cjs');
const {
  VENUE_PLACE_KEYS,
  VENUE_MOVEMENT_KEYS,
  PLACE_ID_RE,
  MAX_WALKING_MINUTES,
} = require('../venue.cjs');
const {
  THEME_DOC_KEYS,
  THEME_COLOR_KEYS,
  THEME_FONT_ROLES,
  THEME_FONT_SET_IDS,
  THEME_LOGO_SLOTS,
  THEME_MODE_POLICIES,
  THEME_RADIUS_IDS,
  THEME_TEXTURES,
  THEME_PRESET_IDS,
  THEME_MOTIF_SET_IDS,
  THEME_NAV_PLACEMENTS,
  THEME_MODES,
  getPreset,
  canonicalColorKey,
  overrideTokenKey,
} = require('../theme.cjs');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * A track letter: one capital, A to Z (design brief §4.6, "lines, lettered
 * A, B, C"). One character because the letter is a wayfinding mark that has
 * to read at a glance inside a route shape, and 26 is more concurrent tracks
 * than any event this platform serves will run.
 */
const TRACK_LETTER_RE = /^[A-Z]$/;
/** Keys a `config/event.tracks[]` entry may carry. */
const TRACK_KEYS = Object.freeze(['letter', 'name']);
const HHMM_RE = /^\d{2}:\d{2}$/;
const NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Deliberately loose (local@domain.tld) — deliverability is the sender
// domain verification's job, not the schema's. This only refuses values
// that cannot be a From address at all.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every key config/features may carry (spec §2.2). Unknown keys are
// rejected so a typo'd toggle fails loudly instead of silently defaulting.
const KNOWN_FEATURE_KEYS = [
  'schedule', 'speakers', 'sponsors', 'attendeeDirectory',
  'sessionBookmarks', 'sessionReactions', 'sessionMaterials',
  'badges', 'liveUpdates', 'feedbackInbox',
  'schedulePdf', 'icsExport', 'updates',
  'autoApproveTicketHolders', 'publicAttendeeProfiles',
];

/** @param {*} v @returns {boolean} */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * True when the string matches YYYY-MM-DD *and* names a real calendar date.
 * `new Date(Date.UTC(...))` normalizes out-of-range components instead of
 * rejecting them (e.g. 2026-02-30 silently becomes 2026-03-02) — round-trip
 * the parsed components against the normalized result to catch that.
 *
 * @param {*} v
 * @returns {boolean}
 */
function isValidCalendarDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, mo, d] = v.split('-').map(Number);
  const normalized = new Date(Date.UTC(y, mo - 1, d));
  return (
    normalized.getUTCFullYear() === y &&
    normalized.getUTCMonth() === mo - 1 &&
    normalized.getUTCDate() === d
  );
}

/**
 * True when the string names a real IANA timezone, probed via Intl.
 *
 * @param {*} tz
 * @returns {boolean}
 */
function isValidTimezone(tz) {
  if (!isNonEmptyString(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a config/event document (spec §2.2).
 *
 * @param {object} event
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateEventConfig(event) {
  const errors = [];
  if (!event || typeof event !== 'object') {
    return { ok: false, errors: ['event: must be an object'] };
  }

  if (!isNonEmptyString(event.name)) errors.push('name: must be a nonempty string');
  if (!isNonEmptyString(event.shortName)) errors.push('shortName: must be a nonempty string');
  if (!isValidTimezone(event.timezone)) {
    errors.push(`timezone: must be a valid IANA timezone (got ${JSON.stringify(event.timezone)})`);
  }
  if (event.tagline != null && typeof event.tagline !== 'string') {
    errors.push('tagline: must be a string or absent');
  }

  if (!Array.isArray(event.days)) {
    errors.push('days: must be an array');
  } else {
    const seenIds = new Set();
    event.days.forEach((day, i) => {
      const at = `days[${i}]`;
      if (!day || typeof day !== 'object') {
        errors.push(`${at}: must be an object`);
        return;
      }
      if (!isNonEmptyString(day.id)) {
        errors.push(`${at}.id: must be a nonempty string`);
      } else if (seenIds.has(day.id)) {
        errors.push(`${at}.id: duplicate day id "${day.id}"`);
      } else {
        seenIds.add(day.id);
      }
      if (!isValidCalendarDate(day.date)) {
        errors.push(`${at}.date: must match YYYY-MM-DD and name a real calendar date`);
      }
      const startOk = typeof day.startTime === 'string' && HHMM_RE.test(day.startTime);
      const endOk = typeof day.endTime === 'string' && HHMM_RE.test(day.endTime);
      if (!startOk) errors.push(`${at}.startTime: must match HH:MM`);
      if (!endOk) errors.push(`${at}.endTime: must match HH:MM`);
      if (startOk && endOk && day.startTime >= day.endTime) {
        errors.push(`${at}: startTime must be before endTime`);
      }
    });
    // Days must be listed in strictly ascending date order — downstream
    // consumers take first/last for event boundaries, and duplicate dates
    // are ambiguous. Only checked between entries whose dates parsed.
    for (let i = 1; i < event.days.length; i++) {
      const prev = event.days[i - 1];
      const cur = event.days[i];
      const prevDateOk = prev && typeof prev.date === 'string' && DATE_RE.test(prev.date);
      const curDateOk = cur && typeof cur.date === 'string' && DATE_RE.test(cur.date);
      if (prevDateOk && curDateOk && prev.date >= cur.date) {
        errors.push(`days[${i}].date: dates must be strictly ascending ("${cur.date}" is not after "${prev.date}")`);
      }
    }
  }

  // The event's concurrent tracks (design brief §4.6). Optional: an event
  // with one room runs no tracks, and every deployment made before this
  // field existed carries none. A session names a track by its LETTER
  // (cmsSchedule.track); the name lives here once, so renaming a track is
  // one edit rather than a sweep of every session.
  //
  // Array order is the order the schedule grid puts the columns in.
  if (event.tracks != null) {
    if (!Array.isArray(event.tracks)) {
      errors.push('tracks: must be an array');
    } else {
      const seenLetters = new Set();
      event.tracks.forEach((track, i) => {
        const at = `tracks[${i}]`;
        if (!track || typeof track !== 'object' || Array.isArray(track)) {
          errors.push(`${at}: must be an object`);
          return;
        }
        for (const key of Object.keys(track)) {
          if (!TRACK_KEYS.includes(key)) errors.push(`${at}.${key}: unknown track field`);
        }
        if (typeof track.letter !== 'string' || !TRACK_LETTER_RE.test(track.letter)) {
          errors.push(`${at}.letter: must be a single capital letter A-Z, got ${JSON.stringify(track.letter)}`);
        } else if (seenLetters.has(track.letter)) {
          errors.push(`${at}.letter: duplicate track letter "${track.letter}"`);
        } else {
          seenLetters.add(track.letter);
        }
        // A line is told apart by its letter AND its name (brief §4.6), so
        // an unnamed track is not a track.
        if (!isNonEmptyString(track.name)) {
          errors.push(`${at}.name: must be a nonempty string`);
        }
      });
    }
  }

  // THE MOVEMENT MODEL (design brief §4.6; shared/venue.cjs states the
  // whole contract and why each rule is there). Two lists under `venue`,
  // beside the address, because a route is a fact about a building rather
  // than about a session:
  //
  //   places[]     the named rooms a session can point at by `placeId`
  //   movements[]  one recorded move from one place to another, with the
  //                walk in whole minutes and, optionally, the step-free way
  //
  // Both optional. A venue that has surveyed nothing records nothing, and
  // the schedule then states no movement at all — which is exactly right,
  // and is why this validator never fills anything in.
  //
  // A MOVEMENT NAMING AN UNDEFINED PLACE IS REFUSED BY NAME. It is the one
  // error this shape actually invites: an operator renames a room, the
  // place id changes, and the routes that pointed at it become sentences
  // about a room that no longer exists. Refusing at the save is the only
  // place that can be caught — a renderer meeting it has nothing to say and
  // no way to say why.
  const venue = event.venue;
  if (venue != null) {
    if (typeof venue !== 'object' || Array.isArray(venue)) {
      errors.push('venue: must be an object or null');
    } else {
      const placeIds = new Set();
      if (venue.places != null) {
        if (!Array.isArray(venue.places)) {
          errors.push('venue.places: must be an array');
        } else {
          venue.places.forEach((place, i) => {
            const at = `venue.places[${i}]`;
            if (!place || typeof place !== 'object' || Array.isArray(place)) {
              errors.push(`${at}: must be an object`);
              return;
            }
            for (const key of Object.keys(place)) {
              if (!VENUE_PLACE_KEYS.includes(key)) errors.push(`${at}.${key}: unknown place field`);
            }
            if (typeof place.id !== 'string' || !PLACE_ID_RE.test(place.id)) {
              errors.push(
                `${at}.id: must be lowercase letters, digits and single hyphens, ` +
                `got ${JSON.stringify(place.id)}`,
              );
            } else if (placeIds.has(place.id)) {
              errors.push(`${at}.id: duplicate place id "${place.id}"`);
            } else {
              placeIds.add(place.id);
            }
            // A place a reader cannot be told the name of is not a place.
            if (!isNonEmptyString(place.name)) {
              errors.push(`${at}.name: must be a nonempty string`);
            }
            if (place.floor != null && !isNonEmptyString(place.floor)) {
              errors.push(`${at}.floor: must be null or a nonempty string`);
            }
          });
        }
      }

      if (venue.movements != null) {
        if (!Array.isArray(venue.movements)) {
          errors.push('venue.movements: must be an array');
        } else {
          const seenPairs = new Set();
          venue.movements.forEach((movement, i) => {
            const at = `venue.movements[${i}]`;
            if (!movement || typeof movement !== 'object' || Array.isArray(movement)) {
              errors.push(`${at}: must be an object`);
              return;
            }
            for (const key of Object.keys(movement)) {
              if (!VENUE_MOVEMENT_KEYS.includes(key)) {
                errors.push(`${at}.${key}: unknown movement field`);
              }
            }
            for (const end of ['from', 'to']) {
              const id = movement[end];
              if (typeof id !== 'string' || !PLACE_ID_RE.test(id)) {
                errors.push(`${at}.${end}: must be a place id, got ${JSON.stringify(id)}`);
              } else if (!placeIds.has(id)) {
                errors.push(
                  `${at}.${end}: "${id}" is not one of this venue's places — ` +
                  'add it to venue.places, or correct the id',
                );
              }
            }
            // A move that starts and ends in the same place is not a move,
            // and a reader told to transfer to the room they are in has
            // been sent somewhere by a page that knows better.
            if (typeof movement.from === 'string' && movement.from === movement.to) {
              errors.push(`${at}: from and to name the same place ("${movement.from}")`);
            }
            // ONE-WAY, so the pair is ordered: A→B and B→A are two records
            // and both are welcome. Two records of the SAME direction are
            // two answers to one question, and the renderer would take
            // whichever came first.
            const pair = `${movement.from}\u0000${movement.to}`;
            if (typeof movement.from === 'string' && typeof movement.to === 'string') {
              if (seenPairs.has(pair)) {
                errors.push(
                  `${at}: a movement from "${movement.from}" to "${movement.to}" is already ` +
                  'recorded — a movement is one-way, so each direction is stated once',
                );
              } else {
                seenPairs.add(pair);
              }
            }
            // Whole minutes, and zero is a real answer: some rooms are
            // across the corridor. The upper bound catches the typo —
            // a 600-minute walk between two rooms is a 6 that slipped.
            const minutes = movement.walkingMinutes;
            if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_WALKING_MINUTES) {
              errors.push(
                `${at}.walkingMinutes: must be a whole number of minutes from 0 to ` +
                `${MAX_WALKING_MINUTES}, got ${JSON.stringify(minutes)}`,
              );
            }
            // Absent means the venue has not surveyed a step-free route,
            // which the site states as silence. It must never be stored as
            // an empty string, because an empty assurance renders as one.
            if (movement.accessibleRoute != null && !isNonEmptyString(movement.accessibleRoute)) {
              errors.push(`${at}.accessibleRoute: must be null or a nonempty string`);
            }
          });
        }
      }
    }
  }

  // sender is email/send.cjs's From-address source: a config/event without
  // a usable sender.email silently kills OTP delivery, so the shape is
  // required here, not left to the mail path to discover at send time.
  const sender = event.sender;
  if (!sender || typeof sender !== 'object' || Array.isArray(sender)) {
    errors.push('sender: must be an object');
  } else {
    if (typeof sender.email !== 'string' || !EMAIL_RE.test(sender.email)) {
      errors.push('sender.email: must be an email address');
    }
    if (sender.name != null && !isNonEmptyString(sender.name)) {
      errors.push('sender.name: must be null or a nonempty string');
    }
    if (sender.replyTo != null && (typeof sender.replyTo !== 'string' || !EMAIL_RE.test(sender.replyTo))) {
      errors.push('sender.replyTo: must be null or an email address');
    }
  }

  const reg = event.registration;
  if (reg != null) {
    if (typeof reg !== 'object') {
      errors.push('registration: must be an object or null');
    } else {
      for (const key of ['opensAt', 'closesAt']) {
        const v = reg[key];
        if (v != null && (typeof v !== 'string' || !NAIVE_ISO_RE.test(v))) {
          errors.push(`registration.${key}: must be null or a naive ISO datetime "YYYY-MM-DDTHH:MM(:SS)"`);
        }
      }
      const opensOk = typeof reg.opensAt === 'string' && NAIVE_ISO_RE.test(reg.opensAt);
      const closesOk = typeof reg.closesAt === 'string' && NAIVE_ISO_RE.test(reg.closesAt);
      if (opensOk && closesOk && reg.opensAt >= reg.closesAt) {
        errors.push('registration: opensAt must be before closesAt');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a config/theme document.
 *
 * `config/theme` is a whole-document replace: the admin editor always
 * sends the complete document, and the write path stores exactly what it
 * validates. So the validator names every field it will accept and rejects
 * anything else BY NAME, the way `validatePageDoc` does. An authenticated
 * caller must not be able to persist a field nothing reads, or an enum
 * value the generator would silently ignore.
 *
 * Every value under theme.colors must be a hex color (#RGB or #RRGGBB) —
 * hex-only because the values are injected into generated CSS custom
 * properties.
 *
 * @param {object} theme
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateTheme(theme) {
  const errors = [];
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    return { ok: false, errors: ['theme: must be an object'] };
  }

  for (const key of Object.keys(theme)) {
    if (!THEME_DOC_KEYS.includes(key)) {
      errors.push(`theme.${key}: unknown config/theme field`);
    }
  }

  if (theme.colors == null || typeof theme.colors !== 'object' || Array.isArray(theme.colors)) {
    errors.push('theme.colors: must be an object');
  } else {
    for (const [key, value] of Object.entries(theme.colors)) {
      if (!THEME_COLOR_KEYS.includes(canonicalColorKey(key))) {
        errors.push(`theme.colors.${key}: unknown color role`);
        continue;
      }
      if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
        errors.push(`theme.colors.${key}: must be a hex color (#RGB or #RRGGBB), got ${JSON.stringify(value)}`);
      }
    }
  }

  // Font ROLES, and only bundled set ids (spec §7.4). A client names a set;
  // a client never supplies a font URL. The retired `accent` role is gone:
  // PR2 removed the `--font-accent` alias (brief §3.2, §7), and Zine's
  // handwritten callout runs on the `--callout-font` component token.
  if (theme.fonts != null) {
    if (typeof theme.fonts !== 'object' || Array.isArray(theme.fonts)) {
      errors.push('theme.fonts: must be an object');
    } else {
      for (const [role, setId] of Object.entries(theme.fonts)) {
        if (!THEME_FONT_ROLES.includes(role)) {
          errors.push(
            `theme.fonts.${role}: unknown font role (expected ${THEME_FONT_ROLES.join(', ')})`,
          );
          continue;
        }
        if (!THEME_FONT_SET_IDS.includes(setId)) {
          errors.push(
            `theme.fonts.${role}: must be a bundled font set id ` +
            `(${THEME_FONT_SET_IDS.join(', ')}), got ${JSON.stringify(setId)}`,
          );
        }
      }
    }
  }

  // The preset (brief §4). `data-theme` carries this id, and it is the base
  // every other theme field refines.
  if (theme.preset != null && !THEME_PRESET_IDS.includes(theme.preset)) {
    errors.push(
      `theme.preset: must be one of ${THEME_PRESET_IDS.join(', ')}, ` +
      `got ${JSON.stringify(theme.preset)}`,
    );
  }

  // The curated option picks (brief §4, §5.2). A group and a choice id are
  // both rejected by name, so a stale pick fails loudly at the editor rather
  // than degrading silently in the generator.
  if (theme.optionPicks != null) {
    if (typeof theme.optionPicks !== 'object' || Array.isArray(theme.optionPicks)) {
      errors.push('theme.optionPicks: must be an object');
    } else {
      const preset = THEME_PRESET_IDS.includes(theme.preset) ? getPreset(theme.preset) : null;
      for (const [group, choiceId] of Object.entries(theme.optionPicks)) {
        if (!preset) {
          errors.push(`theme.optionPicks.${group}: theme.preset must name a preset first`);
          continue;
        }
        const spec = preset.options?.[group];
        if (!spec) {
          errors.push(
            `theme.optionPicks.${group}: the ${preset.label} preset has no option group ` +
            `by that name (expected ${Object.keys(preset.options || {}).join(', ')})`,
          );
          continue;
        }
        const offered = (spec.choices || []).map((choice) => choice.id);
        if (!offered.includes(choiceId)) {
          errors.push(
            `theme.optionPicks.${group}: must be one of ${offered.join(', ')}, ` +
            `got ${JSON.stringify(choiceId)}`,
          );
        }
      }
    }
  }

  // Per-mode raw token overrides — the advanced path (brief §5.2). Only the
  // two modes, and only tokens the system actually resolves: an operator
  // may name the role (`ink`) or the custom property (`--brand-ink-rgb`),
  // and anything else is rejected by name so a typo never persists as a
  // field nothing reads.
  if (theme.tokens != null) {
    if (typeof theme.tokens !== 'object' || Array.isArray(theme.tokens)) {
      errors.push('theme.tokens: must be an object');
    } else {
      for (const [mode, overrides] of Object.entries(theme.tokens)) {
        if (!THEME_MODES.includes(mode)) {
          errors.push(
            `theme.tokens.${mode}: unknown mode (expected ${THEME_MODES.join(', ')})`,
          );
          continue;
        }
        if (overrides == null) continue;
        if (typeof overrides !== 'object' || Array.isArray(overrides)) {
          errors.push(`theme.tokens.${mode}: must be an object`);
          continue;
        }
        for (const [name, value] of Object.entries(overrides)) {
          if (!overrideTokenKey(name)) {
            errors.push(`theme.tokens.${mode}.${name}: not an overridable color token`);
            continue;
          }
          if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
            errors.push(
              `theme.tokens.${mode}.${name}: must be a hex color (#RGB or #RRGGBB), ` +
              `got ${JSON.stringify(value)}`,
            );
          }
        }
      }
    }
  }

  // The motif set the root element switches to (brief §3.8).
  if (theme.motifSet != null && !THEME_MOTIF_SET_IDS.includes(theme.motifSet)) {
    errors.push(
      `theme.motifSet: must be one of ${THEME_MOTIF_SET_IDS.join(', ')}, ` +
      `got ${JSON.stringify(theme.motifSet)}`,
    );
  }

  // The one client-owned colour in the admin identity (admin story part 6f).
  // Its legibility floor is applied at render time, not here: the value is
  // never clamped, so a failing accent saves and the editor states what it
  // fell back to.
  if (theme.adminAccent != null
    && (typeof theme.adminAccent !== 'string' || !HEX_COLOR_RE.test(theme.adminAccent))) {
    errors.push(
      'theme.adminAccent: must be a hex color (#RGB or #RRGGBB), ' +
      `got ${JSON.stringify(theme.adminAccent)}`,
    );
  }

  const enums = [
    ['texture', THEME_TEXTURES],
    ['radius', THEME_RADIUS_IDS],
    ['mode', THEME_MODE_POLICIES],
    // Where the site puts its navigation. Site-level, because a shell that
    // moves between pages stops being a shell (shared/theme
    // THEME_NAV_PLACEMENTS). Optional: a document that says nothing leaves
    // the placement to whatever a page document already stored, and then to
    // the default.
    ['navPlacement', THEME_NAV_PLACEMENTS],
  ];
  for (const [field, allowed] of enums) {
    if (theme[field] == null) continue;
    if (!allowed.includes(theme[field])) {
      errors.push(
        `theme.${field}: must be one of ${allowed.join(', ')}, got ${JSON.stringify(theme[field])}`,
      );
    }
  }

  if (theme.logos != null) {
    if (typeof theme.logos !== 'object' || Array.isArray(theme.logos)) {
      errors.push('theme.logos: must be an object');
    } else {
      for (const [slot, value] of Object.entries(theme.logos)) {
        if (!THEME_LOGO_SLOTS.includes(slot)) {
          errors.push(`theme.logos.${slot}: unknown logo slot`);
          continue;
        }
        if (!isNonEmptyString(value)) {
          errors.push(`theme.logos.${slot}: must be a nonempty storage path`);
        }
      }
    }
  }

  if (theme.placeholderLogos != null) {
    if (!Array.isArray(theme.placeholderLogos)) {
      errors.push('theme.placeholderLogos: must be an array');
    } else {
      for (const [i, slot] of theme.placeholderLogos.entries()) {
        if (!THEME_LOGO_SLOTS.includes(slot)) {
          errors.push(`theme.placeholderLogos[${i}]: unknown logo slot ${JSON.stringify(slot)}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a config/badges document:
 * `{ categories: [{ id, label, maxPicks, badges: [{ id, label, ... }] }] }`.
 * Category ids unique, badge ids unique across all categories, maxPicks a
 * positive integer, and the total a user could ever have stored at once
 * bounded by MAX_TOTAL_BADGES.
 *
 * That last check exists because `firestore.rules` caps a stored `badges`
 * array at MAX_TOTAL_BADGES entries (it cannot read this config to check
 * membership, so it can only bound the array's size) — without this check
 * an operator could configure e.g. one category with maxPicks 41, the
 * picker would let an attendee select all 41, and the save would fail at
 * the rules boundary with a generic error the attendee cannot act on. The
 * bound is the sum, across categories, of `min(maxPicks, badge count)` —
 * the actual maximum number of ids an attendee could ever have selected at
 * once — not the total number of badges configured, since a category can
 * offer far more badges than its maxPicks lets anyone pick.
 *
 * @param {object} badges
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateBadgesConfig(badges) {
  const errors = [];
  if (!badges || typeof badges !== 'object') {
    return { ok: false, errors: ['badges: must be an object'] };
  }
  if (!Array.isArray(badges.categories)) {
    return { ok: false, errors: ['badges.categories: must be an array'] };
  }
  const categoryIds = new Set();
  const badgeIds = new Set();
  let maxSelectable = 0;
  badges.categories.forEach((cat, i) => {
    const at = `badges.categories[${i}]`;
    if (!cat || typeof cat !== 'object') {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (!isNonEmptyString(cat.id)) {
      errors.push(`${at}.id: must be a nonempty string`);
    } else if (categoryIds.has(cat.id)) {
      errors.push(`${at}.id: duplicate category id "${cat.id}"`);
    } else {
      categoryIds.add(cat.id);
    }
    if (!Number.isInteger(cat.maxPicks) || cat.maxPicks < 1) {
      errors.push(`${at}.maxPicks: must be a positive integer`);
    }
    if (!Array.isArray(cat.badges)) {
      errors.push(`${at}.badges: must be an array`);
      return;
    }
    cat.badges.forEach((badge, j) => {
      const bat = `${at}.badges[${j}]`;
      if (!badge || typeof badge !== 'object' || !isNonEmptyString(badge.id)) {
        errors.push(`${bat}.id: must be a nonempty string`);
        return;
      }
      if (badgeIds.has(badge.id)) {
        errors.push(`${bat}.id: duplicate badge id "${badge.id}"`);
      } else {
        badgeIds.add(badge.id);
      }
    });
    const cap = Number.isInteger(cat.maxPicks) && cat.maxPicks > 0 ? cat.maxPicks : cat.badges.length;
    maxSelectable += Math.min(cap, cat.badges.length);
  });
  if (maxSelectable > MAX_TOTAL_BADGES) {
    errors.push(
      `badges: the maximum an attendee could select across all categories (${maxSelectable}) ` +
        `exceeds the platform limit of ${MAX_TOTAL_BADGES} — lower one or more categories' maxPicks`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a config/features document: booleans only, unknown keys
 * rejected.
 *
 * @param {object} features
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateFeatures(features) {
  const errors = [];
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    return { ok: false, errors: ['features: must be an object'] };
  }
  for (const [key, value] of Object.entries(features)) {
    if (!KNOWN_FEATURE_KEYS.includes(key)) {
      errors.push(`features.${key}: unknown feature key`);
      continue;
    }
    if (typeof value !== 'boolean') {
      errors.push(`features.${key}: must be a boolean, got ${JSON.stringify(value)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateEventConfig,
  validateTheme,
  validateBadgesConfig,
  validateFeatures,
  KNOWN_FEATURE_KEYS,
  TRACK_LETTER_RE,
};
