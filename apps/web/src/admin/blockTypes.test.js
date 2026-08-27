// Contract test for the admin block palette (spec §5.2): the browser mirror
// in blockTypes.js must match the backend BLOCK_TYPES registry exactly —
// imported from the functions source, the same way the renderer registry's
// parity test does it — so the CMS editor can never offer a block type the
// server would reject, or hide one it accepts.
import { describe, expect, it } from 'vitest';
import * as blockTypesCjs from '../../../../functions/src/cms/blockTypes.cjs';
import {
  BLOCK_TYPES,
  BLOCK_TYPE_IDS,
  STAT_CONTRACT_HINTS,
  blockTypeFieldSummary,
  blockTypeFor,
  blockTypeLabel,
} from './blockTypes.js';

const { BLOCK_TYPES: BACKEND_BLOCK_TYPES } = blockTypesCjs.default ?? blockTypesCjs;

describe('admin block palette', () => {
  it('mirrors the backend registry ids, with no extras', () => {
    expect(Object.keys(BLOCK_TYPES).sort()).toEqual(Object.keys(BACKEND_BLOCK_TYPES).sort());
    expect(BLOCK_TYPE_IDS).toEqual(Object.keys(BLOCK_TYPES));
  });

  it('mirrors each block type’s label, description, and field list', () => {
    for (const [id, backend] of Object.entries(BACKEND_BLOCK_TYPES)) {
      const mirror = BLOCK_TYPES[id];
      expect(mirror.label, `label for '${id}'`).toBe(backend.label);
      expect(mirror.description, `description for '${id}'`).toBe(backend.description);
      expect(mirror.fields, `fields for '${id}'`).toEqual(
        backend.fields.map((field) => ({
          id: field.id,
          type: field.type,
          required: field.required,
        })),
      );
    }
  });

  it('resolves unknown ids to null rather than a prototype member', () => {
    expect(blockTypeFor('toString')).toBeNull();
    expect(blockTypeFor(undefined)).toBeNull();
    expect(blockTypeLabel('not-a-type')).toBe('not-a-type');
    expect(blockTypeFieldSummary('not-a-type')).toBe('');
  });

  it('summarizes a block type’s fields for the editor', () => {
    expect(blockTypeFieldSummary('image')).toBe(
      'url (url) · alt (string) · caption (string, optional) · ' +
        'focalX (number, optional) · focalY (number, optional)',
    );
  });

  // The stat contract (design brief §2.1.1) is enforced on write from PR3
  // on, so the editor must ask for exactly the parts the server demands —
  // no silent extra prompt, and no part the operator is never told about.
  it('prompts for exactly the parts the server enforces', () => {
    const enforced = Object.keys(blockTypesCjs.internals.STAT_CONTRACT);
    expect(Object.keys(STAT_CONTRACT_HINTS).sort()).toEqual([...enforced].sort());
    for (const id of enforced) {
      expect(BLOCK_TYPES.stat.fields.find((field) => field.id === id)?.required, id).toBe(true);
    }
  });

  it('counts the figure and its caption among the enforced parts', () => {
    // The registry has always marked both required; the write contract now
    // says so too, so a stat block cannot be written with evidence and no
    // number.
    const enforced = Object.keys(blockTypesCjs.internals.STAT_CONTRACT);
    expect(enforced).toContain('value');
    expect(enforced).toContain('label');
  });

  it('keeps the legacy figure and caption on the stat block', () => {
    // Compat is law: the shape a stored stat block already has stays part
    // of the type, so a legacy document still renders and still edits.
    const ids = BLOCK_TYPES.stat.fields.map((field) => field.id);
    expect(ids).toContain('value');
    expect(ids).toContain('label');
  });
});
