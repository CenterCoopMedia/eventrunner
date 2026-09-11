// lib/clipboard.js — the copy action behind the plain text view (issue #166).
import { describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard.js';

function fakeDocument({ execCommandResult = true } = {}) {
  const area = {
    value: '',
    style: {},
    select: vi.fn(),
    remove: vi.fn(),
    setAttribute: vi.fn(),
  };
  return {
    area,
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => execCommandResult),
  };
}

describe('copyTextToClipboard', () => {
  it('uses the async clipboard API where it exists and reports success', async () => {
    const writeText = vi.fn(async () => {});
    const navigatorRef = { clipboard: { writeText } };
    const ok = await copyTextToClipboard('hello', { navigatorRef, documentRef: {} });
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(ok).toBe(true);
  });

  it('falls back to the select-and-copy path when the API refuses', async () => {
    const documentRef = fakeDocument();
    const navigatorRef = { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } };
    const ok = await copyTextToClipboard('hello', { navigatorRef, documentRef });
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });

  it('reports failure when neither path can copy', async () => {
    const documentRef = fakeDocument({ execCommandResult: false });
    const ok = await copyTextToClipboard('hello', { navigatorRef: {}, documentRef });
    expect(ok).toBe(false);
  });

  it('copies nothing when handed nothing', async () => {
    const navigatorRef = { clipboard: { writeText: vi.fn() } };
    expect(await copyTextToClipboard('', { navigatorRef, documentRef: {} })).toBe(false);
    expect(navigatorRef.clipboard.writeText).not.toHaveBeenCalled();
  });
});
