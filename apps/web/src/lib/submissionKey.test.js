import { describe, expect, it } from 'vitest';
import { createSubmissionKey, newSubmissionKey } from './submissionKey.js';

describe('submissionKey', () => {
  it('makes keys in the server’s shape', () => {
    expect(newSubmissionKey()).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('keeps the key for the same payload, and takes a new one when it changes', () => {
    const session = createSubmissionKey();
    const first = session.keyFor({ message: 'Hello', page: null });
    expect(session.keyFor({ message: 'Hello', page: null })).toBe(first);
    const second = session.keyFor({ message: 'Hello there', page: null });
    expect(second).not.toBe(first);
    expect(session.keyFor({ message: 'Hello there', page: null })).toBe(second);
    // Back to the first text is still a change from the last one sent.
    expect(session.keyFor({ message: 'Hello', page: null })).not.toBe(second);
  });

  it('starts a new request after reset, even for the same text', () => {
    const session = createSubmissionKey();
    const first = session.keyFor({ message: 'Hello', page: null });
    session.reset();
    expect(session.keyFor({ message: 'Hello', page: null })).not.toBe(first);
  });
});
