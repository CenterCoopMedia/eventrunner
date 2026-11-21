// lib/schedulePdf.js — the control behind features.schedulePdf (issue #166).
import { afterEach, describe, expect, it, vi } from 'vitest';

const { downloadMySchedulePdf, downloadSchedulePdf, SchedulePdfError } = await import('./schedulePdf.js');

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

    expect(fetchImpl).toHaveBeenCalledWith('https://functions.example/buildSchedulePdf', { signal: undefined });
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

  it('never hands a superseded download to the browser when its bytes arrive late', async () => {
    const controller = new AbortController();
    let receiveBytes;
    let readingBody;
    const bodyStarted = new Promise((resolve) => { readingBody = resolve; });
    const pendingBody = new Promise((resolve) => { receiveBytes = resolve; });
    const fetchImpl = async () => ({ ok: true, blob() { readingBody(); return pendingBody; } });
    const doc = fakeDocument();
    const request = downloadSchedulePdf({ origin: 'https://functions.example', fetchImpl, documentRef: doc, signal: controller.signal });

    await bodyStarted;
    controller.abort();
    receiveBytes(new Blob(['late-pdf-bytes']));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(doc.anchor.click).not.toHaveBeenCalled();
  });
});

it('transports the selected locale in the public URL and the owner POST body', async () => {
  const origin = 'https://functions.example.org';
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
  const options = { origin, language: 'es', fetchImpl, documentRef: {} };
  await expect(downloadSchedulePdf(options)).rejects.toBeInstanceOf(SchedulePdfError);
  const user = { getIdToken: async () => 'fixture-token' };
  await expect(downloadMySchedulePdf({ ...options, user })).rejects.toBeInstanceOf(SchedulePdfError);
  expect(fetchImpl.mock.calls).toEqual([
    ['https://functions.example.org/buildSchedulePdf?lang=es', { signal: undefined }],
    ['https://functions.example.org/buildMySchedulePdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-token' },
      body: '{"lang":"es"}',
    }],
  ]);
});
