import { describe, expect, it } from 'vitest';
import { STATUS_FILTERS, STATUS_LABELS, firstSettingError } from './reviewText.js';
import { STATUS_LABELS as CLIENT_STATUS_LABELS } from './setup/steps.js';

import { CONSOLE_REQUEST_STATUSES as SERVER_STATUSES } from 'shared/consoleRequest';

const GOOD = { gcpFolder: 'folders/123456789012', billingAccount: '012345-6789AB-CDEF01', region: 'us-central1' };
const ALL = Object.keys(GOOD);

describe('reviewText', () => {
  it('has a label for every status filter', () => {
    for (const status of STATUS_FILTERS) expect(STATUS_LABELS[status]).toBeTruthy();
    expect(STATUS_FILTERS[0]).toBe('approved');
  });

  it('names every stored status for the hosting team and for the client, and filters by each', () => {
    for (const status of SERVER_STATUSES) {
      expect(STATUS_LABELS[status], status).toBeTruthy();
      expect(CLIENT_STATUS_LABELS[status], status).toBeTruthy();
      expect(STATUS_FILTERS, status).toContain(status);
    }
  });

  it('accepts good settings and names the first bad one', () => {
    expect(firstSettingError(GOOD, ALL)).toBe(null);
    expect(firstSettingError({ ...GOOD, gcpFolder: '123456789012' }, ALL)).toBe(null);
    expect(firstSettingError({ ...GOOD, billingAccount: 'nope' }, ALL).field).toBe('billingAccount');
    expect(firstSettingError({ ...GOOD, region: '' }, ALL).field).toBe('region');
  });
});
