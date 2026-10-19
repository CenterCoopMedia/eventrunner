// Whether two pitch call settings say the same thing (issue #476). The
// server stores the deadline as `new Date(...).toISOString()`, so the form's
// "2027-01-31T23:59:59-05:00" and the stored "2027-02-01T04:59:59.000Z" are
// one deadline. An external form address is read the way the server and
// /pitch read it, so a blank address and no address are one setting.
import { readPitchFormUrl } from 'shared/pitch';

function instant(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : value;
}

function formUrl(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  return readPitchFormUrl(value) ?? value;
}

/**
 * @param {{ enabled?: boolean, closesAt?: string|null, externalFormUrl?: string|null }} a
 * @param {{ enabled?: boolean, closesAt?: string|null, externalFormUrl?: string|null }} b
 * @returns {boolean}
 */
export function sameCallSettings(a, b) {
  return (a?.enabled === true) === (b?.enabled === true)
    && instant(a?.closesAt) === instant(b?.closesAt)
    && formUrl(a?.externalFormUrl) === formUrl(b?.externalFormUrl);
}
