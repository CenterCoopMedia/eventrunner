import { describe, expect, it } from 'vitest';
import { STATUS_FILTERS, STATUS_LABELS, firstSettingError } from './reviewText.js';

const GOOD = { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' };
const ALL = Object.keys(GOOD);

describe('reviewText', () => {
  it('has a label for every status filter', () => {
    for (const status of STATUS_FILTERS) expect(STATUS_LABELS[status]).toBeTruthy();
    expect(STATUS_FILTERS[0]).toBe('approved');
  });

  it('accepts good settings and names the first bad one', () => {
    expect(firstSettingError(GOOD, ALL)).toBe(null);
    expect(firstSettingError({ ...GOOD, gcpFolder: '123456789012' }, ALL)).toBe(null);
    expect(firstSettingError({ ...GOOD, billingAccount: 'nope' }, ALL).field).toBe('billingAccount');
    expect(firstSettingError({ ...GOOD, region: '' }, ALL).field).toBe('region');
  });
});
