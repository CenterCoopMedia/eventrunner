import { describe, expect, it } from 'vitest';
import { isCanonicalPagePath } from './internalPath.js';

describe('isCanonicalPagePath', () => {
  it('accepts the home path', () => {
    expect(isCanonicalPagePath('/')).toBe(true);
  });

  it('accepts a single-segment root-level route', () => {
    expect(isCanonicalPagePath('/schedule')).toBe(true);
    expect(isCanonicalPagePath('/recap')).toBe(true);
  });

  it('accepts a multi-segment route with hyphenated segments', () => {
    expect(isCanonicalPagePath('/speakers/jane-doe')).toBe(true);
  });

  it('rejects an absolute external URL', () => {
    expect(isCanonicalPagePath('https://example.org/harborlight-2026-photos')).toBe(false);
  });

  it('rejects a protocol-relative URL', () => {
    expect(isCanonicalPagePath('//example.org')).toBe(false);
  });

  it('rejects a mailto link', () => {
    expect(isCanonicalPagePath('mailto:support@example.org')).toBe(false);
  });

  it('rejects a bare fragment', () => {
    expect(isCanonicalPagePath('#section')).toBe(false);
  });

  it('rejects a path carrying a query string or fragment', () => {
    expect(isCanonicalPagePath('/schedule?day=1')).toBe(false);
    expect(isCanonicalPagePath('/schedule#now')).toBe(false);
  });

  it('rejects a trailing slash', () => {
    expect(isCanonicalPagePath('/schedule/')).toBe(false);
  });

  it('rejects a doubled slash', () => {
    expect(isCanonicalPagePath('//schedule')).toBe(false);
  });

  it('rejects an uppercase or underscored segment', () => {
    expect(isCanonicalPagePath('/Schedule')).toBe(false);
    expect(isCanonicalPagePath('/my_page')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isCanonicalPagePath(undefined)).toBe(false);
    expect(isCanonicalPagePath(null)).toBe(false);
    expect(isCanonicalPagePath(42)).toBe(false);
  });
});
