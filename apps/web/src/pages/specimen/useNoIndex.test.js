// The book is never indexable, and it never leaves the tag behind.
import { describe, expect, it } from 'vitest';
import { ROBOTS_SELECTOR, addNoIndexTag, removeNoIndexTag } from './useNoIndex.js';

describe('the noindex tag', () => {
  it('writes one robots tag with the noindex value', () => {
    addNoIndexTag();
    const meta = document.querySelector(ROBOTS_SELECTOR);
    expect(meta).not.toBeNull();
    expect(meta.getAttribute('content')).toBe('noindex');
    removeNoIndexTag();
  });

  it('adds no second tag on a second call', () => {
    addNoIndexTag();
    addNoIndexTag();
    expect(document.querySelectorAll(ROBOTS_SELECTOR)).toHaveLength(1);
    removeNoIndexTag();
  });

  it('leaves no tag behind when the page unmounts', () => {
    addNoIndexTag();
    removeNoIndexTag();
    expect(document.querySelector(ROBOTS_SELECTOR)).toBeNull();
  });

  it('removes nothing when there is nothing to remove', () => {
    expect(() => removeNoIndexTag()).not.toThrow();
  });
});
