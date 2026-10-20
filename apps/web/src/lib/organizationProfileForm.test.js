// The representative form's own checks (issue #334) mirror the server's:
// the same limits, and the same rule for the website.
import { describe, expect, it } from 'vitest';
import * as organizationsCjs from '../../../../functions/src/cms/organizations.cjs';
import { REPRESENTATIVE_LIMITS, representativeFields, validateRepresentativeForm } from './organizationProfileForm.js';

const { ORGANIZATION_LIMITS, REPRESENTATIVE_FIELDS } = organizationsCjs.default ?? organizationsCjs;

describe('the representative form', () => {
  it('holds the server’s limits for exactly the server’s representative fields', () => {
    expect(Object.keys(REPRESENTATIVE_LIMITS)).toEqual([...REPRESENTATIVE_FIELDS]);
    for (const [field, limit] of Object.entries(REPRESENTATIVE_LIMITS)) {
      expect(limit, field).toBe(ORGANIZATION_LIMITS[field]);
    }
  });

  it('sends the three fields trimmed, blank as null', () => {
    expect(representativeFields({ description: '  Hi. ', bio: '   ', url: ' https://a.example.org ' })).toEqual({
      description: 'Hi.', bio: null, url: 'https://a.example.org',
    });
  });

  it('names a long field and a website that is not a web link', () => {
    const errors = validateRepresentativeForm({ description: 'd'.repeat(501), bio: 'b'.repeat(5001), url: 'ftp://a' });
    expect(Object.fromEntries(errors)).toEqual({
      description: 'Use 500 characters or fewer.',
      bio: 'Use 5000 characters or fewer.',
      url: 'Enter a link that starts with http:// or https://.',
    });
    expect(validateRepresentativeForm({ description: '', bio: '', url: '' }).size).toBe(0);
  });
});
