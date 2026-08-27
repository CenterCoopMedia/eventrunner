// Unit tests for the cmsContent form-state helpers (issue #61 follow-up).
// The editor-level flows (browse/create/edit/publish/delete) live in
// pages/AdminContent.test.jsx; this file pins the smaller, easy-to-get-wrong
// pieces those flows depend on: the shared Order control not colliding with
// stat/list_item/link_group's own registry `order` field, required-field
// validation, the type-switch stale-field cleanup, and the DELETE_FIELD_
// SENTINEL literal staying in lockstep with the backend's.
import { describe, expect, it } from 'vitest';
import * as contentCjs from '../../../../functions/src/cms/content.cjs';
import {
  DELETE_FIELD_SENTINEL,
  blankContent,
  staleFieldDeletions,
  toContentFields,
  toEditableContent,
  validateRequiredContent,
  valueFieldsOf,
} from './contentDoc.js';

describe('DELETE_FIELD_SENTINEL', () => {
  it('mirrors the backend content.cjs literal exactly', () => {
    const backend = contentCjs.default ?? contentCjs;
    expect(DELETE_FIELD_SENTINEL).toBe(backend.DELETE_FIELD_SENTINEL);
  });
});

describe('valueFieldsOf', () => {
  it('excludes the shared order field even for types that declare their own', () => {
    expect(valueFieldsOf('stat').map((f) => f.id)).toEqual([
      'value',
      'label',
      'takeaway',
      'description',
      'source',
      'alt',
    ]);
    expect(valueFieldsOf('list_item').map((f) => f.id)).toEqual(['text']);
    expect(valueFieldsOf('link_group').map((f) => f.id)).toEqual(['group', 'label', 'url']);
  });

  it('is unaffected for a type with no order field of its own', () => {
    expect(valueFieldsOf('image').map((f) => f.id)).toEqual([
      'url',
      'alt',
      'caption',
      'focalX',
      'focalY',
    ]);
  });

  it('is empty for an unknown or missing block type', () => {
    expect(valueFieldsOf('not-a-type')).toEqual([]);
    expect(valueFieldsOf(undefined)).toEqual([]);
  });
});

describe('toEditableContent / toContentFields round-trip', () => {
  it('reads a doc’s value fields and the shared order back out unchanged', () => {
    const doc = {
      blockType: 'stat',
      value: '450',
      label: 'attendees',
      takeaway: 'The hall is full',
      description: 'Confirmed registrations across all three days.',
      source: 'Registration list, read 1 September 2026.',
      alt: 'Confirmed registrations stand at 450.',
      order: 3,
      visible: true,
    };
    const editable = toEditableContent(doc, doc.blockType);
    expect(editable).toEqual({
      blockType: 'stat',
      order: 3,
      visible: true,
      values: {
        value: '450',
        label: 'attendees',
        takeaway: 'The hall is full',
        description: 'Confirmed registrations across all three days.',
        source: 'Registration list, read 1 September 2026.',
        alt: 'Confirmed registrations stand at 450.',
      },
    });
    expect(toContentFields(editable)).toEqual({
      blockType: 'stat',
      order: 3,
      value: '450',
      label: 'attendees',
      takeaway: 'The hall is full',
      description: 'Confirmed registrations across all three days.',
      source: 'Registration list, read 1 September 2026.',
      alt: 'Confirmed registrations stand at 450.',
    });
  });

  it('opens a legacy stat block with its four contract parts blank', () => {
    // Compat is law at the READ (design brief §2.1.1): a stored
    // `{ value, label }` block still loads. What the operator meets is four
    // empty required fields, which is what makes the next save bring the
    // block up to contract instead of quietly rewriting it as it was.
    const editable = toEditableContent({ blockType: 'stat', value: '420', label: 'Attendees' }, 'stat');
    expect(editable.values.takeaway).toBe('');
    expect(validateRequiredContent(editable).map((e) => e.field)).toEqual([
      'takeaway',
      'description',
      'source',
      'alt',
    ]);
  });

  it('never reads a per-type "order" field into the editable values', () => {
    // stat's registry entry declares its own `order` field; toEditableContent
    // must not surface it a second time under `values.order`.
    const editable = toEditableContent({ blockType: 'stat', order: 5 }, 'stat');
    expect(editable.values).not.toHaveProperty('order');
    expect(editable.order).toBe(5);
  });

  it('omits an unset optional numeric field rather than sending NaN', () => {
    const fields = toContentFields(blankContent('stat'));
    expect(fields).toEqual({
      blockType: 'stat',
      value: '',
      label: '',
      takeaway: '',
      description: '',
      source: '',
      alt: '',
    });
  });
});

describe('validateRequiredContent', () => {
  it('flags every empty required value field, skipping optional ones', () => {
    const content = blankContent('image'); // url + alt required, caption optional
    const errors = validateRequiredContent(content);
    expect(errors).toEqual([
      { field: 'url', message: 'url: is required.' },
      { field: 'alt', message: 'alt: is required.' },
    ]);
  });

  it('passes once every required field has a non-blank value', () => {
    const content = blankContent('image');
    content.values.url = 'https://example.org/a.png';
    content.values.alt = 'A photo';
    expect(validateRequiredContent(content)).toEqual([]);
  });

  it('never treats a boolean field as "empty" — a checkbox always has a value', () => {
    const content = blankContent('cta'); // label + url required, external optional bool
    content.values.label = 'Apply';
    content.values.url = 'https://example.org';
    expect(validateRequiredContent(content)).toEqual([]);
  });

  it('requires a block type to be chosen at all', () => {
    expect(validateRequiredContent(blankContent(''))).toEqual([
      { field: 'blockType', message: 'blockType: choose a block type before saving.' },
    ]);
  });
});

describe('staleFieldDeletions', () => {
  it('is empty when there is no prior type, or the type did not change', () => {
    expect(staleFieldDeletions(null, 'stat')).toEqual({});
    expect(staleFieldDeletions('stat', 'stat')).toEqual({});
  });

  it('marks the prior type’s fields absent from the new type for deletion', () => {
    expect(staleFieldDeletions('cta', 'stat')).toEqual({
      url: DELETE_FIELD_SENTINEL,
      external: DELETE_FIELD_SENTINEL,
    });
  });

  it('keeps a field name the two types share', () => {
    // Both cta and stat declare a 'label' field — switching between them
    // must not clear it, since the new type still uses that same key.
    const deletions = staleFieldDeletions('cta', 'stat');
    expect(deletions).not.toHaveProperty('label');
  });

  it('never marks the shared order field for deletion', () => {
    const deletions = staleFieldDeletions('stat', 'text');
    expect(deletions).not.toHaveProperty('order');
  });
});
