import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSavedMessage } from './useSavedMessage.js';

describe('submitted-value save feedback', () => {
  it('stops saying saved after a later edit', () => {
    const { result, rerender } = renderHook(({ value }) => useSavedMessage(value), { initialProps: { value: { name: 'Saved event' } } });
    act(() => result.current[1]('Saved.'));
    expect(result.current[0]).toBe('Saved.');
    rerender({ value: { name: 'Unsaved event' } });
    expect(result.current[0]).toBe('');
  });

  it('a delayed save describes its submitted snapshot and preserves newer edits', () => {
    const { result, rerender } = renderHook(({ value }) => useSavedMessage(value), { initialProps: { value: { name: 'Submitted' } } });
    const finishEarlierSave = result.current[1];
    rerender({ value: { name: 'Still editing' } });
    act(() => finishEarlierSave('Saved.'));
    expect(result.current[0]).toBe('');
    act(() => result.current[1]('Saved.'));
    expect(result.current[0]).toBe('Saved.');
  });
});
