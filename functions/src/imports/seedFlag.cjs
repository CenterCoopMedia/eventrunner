'use strict';

/**
 * The seed's bookkeeping, cleared by every admin write (ADR 0001 §5.4), the
 * same rule cms/content.cjs applies to an editor save. An import that
 * updates a seeded record makes it the client's, so the next seed run does
 * not overwrite it.
 */
const SEED_FIELDS = Object.freeze(['seeded', 'seededAt']);

/** @param {object} fields @returns {object} the fields without the seed's bookkeeping */
function withoutSeedFlag(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!SEED_FIELDS.includes(key)) out[key] = value;
  }
  return out;
}

module.exports = { SEED_FIELDS, withoutSeedFlag };
