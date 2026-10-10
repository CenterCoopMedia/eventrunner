import { describe, expect, it } from 'vitest';
import { contentEditIsDirty, contentEditSnapshot } from './contentEditState.js';

const savedContent = {
  blockType: 'cta',
  order: 2,
  visible: true,
  values: { label: 'Register now', url: 'https://example.org/register' },
};

describe('contentEditIsDirty', () => {
  it('stays clean before a snapshot exists and when the form matches it', () => {
    expect(contentEditIsDirty(null, 'register', savedContent)).toBe(false);
    const saved = contentEditSnapshot('register', savedContent);
    expect(contentEditIsDirty(saved, 'register', savedContent)).toBe(false);
  });

  it('is dirty when a field changes and clean when that field returns', () => {
    const saved = contentEditSnapshot('register', savedContent);
    const edited = {
      ...savedContent,
      values: { url: 'https://example.org/register', label: 'Reserve a place' },
    };
    expect(contentEditIsDirty(saved, 'register', edited)).toBe(true);
    expect(contentEditIsDirty(saved, 'register', savedContent)).toBe(false);
  });
});
