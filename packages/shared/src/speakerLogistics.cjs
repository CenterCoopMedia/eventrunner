'use strict';

/**
 * A speaker's logistics answers (ADR 0008 §3): travel, access needs, and
 * audio and video needs. They live in `speaker_logistics/{speakerId}`, a
 * record only staff can read, apart from `speakers/{id}`, so the public
 * speaker copy (built from `speakers`) can never carry them.
 */

const LOGISTICS_FIELDS = Object.freeze(['travel', 'accessNeeds', 'avNeeds']);
const MAX_LOGISTICS_LENGTH = 1000;

/**
 * Check a logistics payload. Every field is optional text; an empty answer
 * is stored as null. Unknown keys are refused by name.
 *
 * @returns {{ ok: true, logistics: Record<string, string|null> } | { ok: false, errors: string[] }}
 */
function checkLogistics(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['logistics: must be an object'] };
  }
  const errors = [];
  for (const key of Object.keys(payload)) {
    if (!LOGISTICS_FIELDS.includes(key)) errors.push(`logistics.${key}: is not a logistics field`);
  }
  const logistics = {};
  for (const key of LOGISTICS_FIELDS) {
    const value = payload[key];
    if (value === undefined || value === null) { logistics[key] = null; continue; }
    if (typeof value !== 'string') { errors.push(`logistics.${key}: must be text`); continue; }
    const text = value.trim();
    if (text.length > MAX_LOGISTICS_LENGTH) { errors.push(`logistics.${key}: must be at most ${MAX_LOGISTICS_LENGTH} characters`); continue; }
    logistics[key] = text || null;
  }
  return errors.length ? { ok: false, errors } : { ok: true, logistics };
}

/** A stored record read safely: every field as text or null. */
function readLogistics(stored) {
  const out = {};
  for (const key of LOGISTICS_FIELDS) out[key] = typeof stored?.[key] === 'string' && stored[key] ? stored[key] : null;
  return out;
}

module.exports = { LOGISTICS_FIELDS, MAX_LOGISTICS_LENGTH, checkLogistics, readLogistics };
