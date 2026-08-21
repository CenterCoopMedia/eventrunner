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
      'url (url) · alt (string) · caption (string, optional)',
    );
  });
});
