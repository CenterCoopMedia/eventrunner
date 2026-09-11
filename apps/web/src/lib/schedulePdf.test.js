// lib/schedulePdf.js — the control behind features.schedulePdf (issue #166).
import { afterEach, describe, expect, it, vi } from 'vitest';

const { downloadSchedulePdf, SchedulePdfError } = await import('./schedulePdf.js');

function fakeDocument() {
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  return {
    anchor,
    createElement: vi.fn(() => anchor),
    body: { appendChild: vi.fn() },
  };
}

function okResponse(blob) {
  return { ok: true, blob: async () => blob };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadSchedulePdf', () => {
  it('fetches the endpoint and hands the bytes to a download anchor', async () => {
    const blob = new Blob(['pdf-bytes']);
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const fetchImpl = vi.fn(async () => okResponse(blob));
    const doc = fakeDocument();

    await downloadSchedulePdf({ origin: 'https://functions.example', fetchImpl, documentRef: doc });

    expect(fetchImpl).toHaveBeenCalledWith('https://functions.example/buildSchedulePdf');
    expect(doc.anchor.download).toBe('schedule.pdf');
    expect(doc.anchor.click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('a refusal from the server reads as an error the page can state', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    await expect(
      downloadSchedulePdf({ origin: 'https://functions.example', fetchImpl, documentRef: fakeDocument() }),
    ).rejects.toBeInstanceOf(SchedulePdfError);
  });

  it('a network failure reads as an error too', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      downloadSchedulePdf({ origin: 'https://functions.example', fetchImpl, documentRef: fakeDocument() }),
    ).rejects.toBeInstanceOf(SchedulePdfError);
  });
});
