'use strict';

/**
 * Shared slug generation for sessions and speakers. Ported verbatim in
 * behavior from the reference implementation's frontend slug utilities
 * (spec §9 porting map); the trivial find-by-slug helper is inlined at its
 * call sites instead of ported.
 */

/**
 * Generate a URL-safe slug from text. Strips diacritics, lowercases, and
 * replaces non-alphanumeric runs with hyphens.
 *
 * @param {string} text
 * @returns {string}
 */
function generateSlug(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Generate a speaker slug from first and last name.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @returns {string}
 */
function generateSpeakerSlug(firstName, lastName) {
  return generateSlug(`${firstName || ''} ${lastName || ''}`.trim());
}

module.exports = { generateSlug, generateSpeakerSlug };
