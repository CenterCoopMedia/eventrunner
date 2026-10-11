import { describe, expect, it } from 'vitest';
import { blankContent } from './contentDoc.js';
import { contentEditIsDirty, contentEditSnapshot, createFormBaseline } from './contentEditState.js';

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

describe('createFormBaseline', () => {
  it('uses the empty default when the operator has not edited', () => {
    const result = createFormBaseline({
      fieldId: '',
      content: blankContent(),
      fallbackType: 'image',
    });
    expect(result.nextContent.blockType).toBe('image');
    expect(contentEditIsDirty(result.snapshot, '', result.nextContent)).toBe(false);
  });

  it('does not treat text typed before the default type arrives as saved', () => {
    const typed = blankContent('cta');
    typed.values = { ...typed.values, label: 'Reserve a place' };
    const result = createFormBaseline({
      fieldId: 'register',
      content: typed,
      fallbackType: 'image',
    });
    expect(result.nextContent).toBeNull();
    expect(result.snapshot).toMatchObject({ fieldId: '', blockType: 'image' });
    expect(contentEditIsDirty(result.snapshot, 'register', typed)).toBe(true);
  });
});
