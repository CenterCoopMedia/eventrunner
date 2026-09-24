// The organization form helpers (issue #192). The editor-level flows live
// in pages/AdminOrganizations.test.jsx; this file pins the pieces they rest
// on: the merge and its order, the address a name suggests, the payload,
// and the limits the editor shares with the server.
import { describe, expect, it } from 'vitest';
import * as organizationsCjs from '../../../../functions/src/cms/organizations.cjs';
import {
  ORGANIZATION_FIELD_LIMITS,
  ORGANIZATION_SLUG_RE,
  mergeOrganizationRevisions,
  nextOrganizationOrder,
  organizationFields,
  organizationSlugFromName,
  tiersInUse,
  validateOrganizationForm,
} from './organizationDoc.js';

const { ORGANIZATION_LIMITS, ORGANIZATION_SLUG_RE: SERVER_SLUG_RE } =
  organizationsCjs.default ?? organizationsCjs;

const FORM = Object.freeze({
  slug: 'example-fund',
  name: 'Example Fund',
  tier: 'presenting',
  order: '1',
  logoPath: 'cms-images/fund.webp',
  url: 'https://example.org',
  description: 'Funds the travel grants.',
  visible: true,
});

describe('organization revisions', () => {
  it('merges live and draft into one row each, in the order the sponsors wall draws', () => {
    const rows = mergeOrganizationRevisions(
      [
        { id: 'b-org', name: 'B', order: 1, visible: true },
        { id: 'a-org', name: 'A', order: 1, visible: true },
        { id: 'first', name: 'First', order: 0, visible: true },
      ],
      [
        { id: 'a-org', name: 'A changed', order: 1, status: 'dirty' },
        { id: 'new-org', name: 'New', order: 5, status: 'dirty' },
        { id: 'unordered', name: 'No order', status: 'dirty' },
      ],
    );
    // order, then id; a record with no order sorts as 0, as the wall does.
    expect(rows.map((row) => row.id)).toEqual(['first', 'unordered', 'a-org', 'b-org', 'new-org']);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId['a-org'].current.name).toBe('A changed');
    expect(byId['a-org'].state.id).toBe('dirty');
    expect(byId['new-org'].state.id).toBe('draft');
    expect(byId['b-org'].state.id).toBe('live');
  });

  it('reads nothing into an empty or missing set', () => {
    expect(mergeOrganizationRevisions(null, null)).toEqual([]);
  });
});

describe('the page address', () => {
  it('follows the name through the shared slug rule', () => {
    expect(organizationSlugFromName('Beacon Community Fund')).toBe('beacon-community-fund');
    expect(organizationSlugFromName('  Café & Co. ')).toBe('cafe-co');
    expect(organizationSlugFromName('')).toBe('');
  });

  it('stops at the limit without leaving a hyphen at the end', () => {
    const slug = organizationSlugFromName(`${'a'.repeat(79)} b`);
    expect(slug).toBe('a'.repeat(79));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(ORGANIZATION_SLUG_RE.test(organizationSlugFromName(`${'word '.repeat(30)}`))).toBe(true);
  });

  it('is the shape the server checks', () => {
    expect(ORGANIZATION_SLUG_RE.source).toBe(SERVER_SLUG_RE.source);
  });
});

describe('the payload', () => {
  it('sends the six editor fields, trimmed, with blanks as null', () => {
    expect(organizationFields({ ...FORM, name: ' Example Fund ', tier: ' ', url: '', description: '  ' })).toEqual({
      name: 'Example Fund',
      tier: null,
      order: 1,
      logoPath: 'cms-images/fund.webp',
      url: null,
      description: null,
    });
  });

  it('sends the order as a number, blank as null, and anything else as typed', () => {
    expect(organizationFields({ ...FORM, order: '2.5' }).order).toBe(2.5);
    expect(organizationFields({ ...FORM, order: '' }).order).toBeNull();
    expect(organizationFields({ ...FORM, order: 'first' }).order).toBe('first');
  });

  it('never sends a profile field, the seed flag, or the page address', () => {
    const fields = organizationFields({ ...FORM, bio: 'x', seeded: true });
    expect(Object.keys(fields).sort()).toEqual(['description', 'logoPath', 'name', 'order', 'tier', 'url']);
  });
});

describe('the list helpers', () => {
  const rows = mergeOrganizationRevisions(
    [
      { id: 'a', tier: 'gold', order: 3 },
      { id: 'b', tier: 'Gold', order: 7 },
      { id: 'c', tier: ' gold ', order: 'x' },
      { id: 'd', tier: null },
    ],
    [],
  );

  it('offers each tier in use once, spelled as written', () => {
    expect(tiersInUse(rows)).toEqual(['gold', 'Gold']);
  });

  it('puts a new organization after the last', () => {
    expect(nextOrganizationOrder(rows)).toBe(8);
    expect(nextOrganizationOrder([])).toBe(0);
  });
});

describe('the editor’s own checks', () => {
  it('passes a complete form', () => {
    expect(validateOrganizationForm(FORM, { mode: 'create' }).size).toBe(0);
  });

  it('names the name, the address, the website and the order', () => {
    const errors = validateOrganizationForm(
      { ...FORM, name: ' ', slug: 'Bad Slug', url: 'javascript:alert(1)', order: 'first' },
      { mode: 'create' },
    );
    expect([...errors.keys()].sort()).toEqual(['name', 'order', 'slug', 'url']);
    expect(validateOrganizationForm({ ...FORM, slug: '' }, { mode: 'create' }).get('slug')).toBe('Enter a page address.');
  });

  it('does not check the address of a record that already has one', () => {
    expect(validateOrganizationForm({ ...FORM, slug: 'Legacy_Id' }, { mode: 'edit' }).size).toBe(0);
  });

  it('holds each field to the server’s limit', () => {
    for (const [field, limit] of Object.entries(ORGANIZATION_FIELD_LIMITS)) {
      expect(limit, field).toBe(ORGANIZATION_LIMITS[field]);
    }
    const long = (field) => 'a'.repeat(ORGANIZATION_FIELD_LIMITS[field] + 1);
    const errors = validateOrganizationForm(
      { ...FORM, name: long('name'), tier: long('tier'), description: long('description') },
      { mode: 'edit' },
    );
    expect(errors.get('name')).toBe('Use 120 characters or fewer.');
    expect(errors.get('tier')).toBe('Use 60 characters or fewer.');
    expect(errors.get('description')).toBe('Use 500 characters or fewer.');
  });
});
