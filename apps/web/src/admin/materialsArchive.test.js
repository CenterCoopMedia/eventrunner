// The browser half of the materials archive (issue #189).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../contexts/AuthContext.jsx', () => ({
  functionsOrigin: () => 'https://fake-functions.example',
}));

const { downloadMaterialsArchive, STOPPED_MESSAGE } = await import('./materialsArchive.js');
const { AdminApiError } = await import('./adminApi.js');

describe('downloadMaterialsArchive', () => {
  let clicked;
  let originalCreate;
  let originalRevoke;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:archive');
    URL.revokeObjectURL = vi.fn();
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      clicked.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  const getIdToken = async () => 'id-token';

  it('posts the ids with the bearer token and saves session-materials.zip, revoking the URL on the next tick', async () => {
    const blob = new Blob(['PK'], { type: 'application/zip' });
    fetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => blob });

    await downloadMaterialsArchive({ getIdToken, materialIds: ['m1', 'm2'] });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://fake-functions.example/downloadSessionMaterialsArchive');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ materialIds: ['m1', 'm2'] });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: 'blob:archive', download: 'session-materials.zip' }]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:archive');
  });

  it('turns a JSON refusal into an AdminApiError with the server message, and saves nothing', async () => {
    const message = 'materialIds: the selected files come to 12.0 MB. An archive holds at most 9 MB. Select fewer files.';
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({ error: { code: 'too-large', message } }),
    });
    const error = await downloadMaterialsArchive({ getIdToken, materialIds: ['m1'] }).catch((err) => err);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ code: 'too-large', status: 413, message });
    expect(clicked).toEqual([]);
  });

  it('states the network sentence when the request cannot be made', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await downloadMaterialsArchive({ getIdToken, materialIds: ['m1'] }).catch((err) => err);
    expect(error).toMatchObject({
      code: 'network',
      message: 'We could not reach the server. Check your connection and try again.',
    });
  });

  it('states the stopped sentence and saves nothing when the body is cut off', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => {
        throw new TypeError('network error');
      },
    });
    const error = await downloadMaterialsArchive({ getIdToken, materialIds: ['m1'] }).catch((err) => err);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ code: 'network', message: STOPPED_MESSAGE });
    expect(STOPPED_MESSAGE).toBe(
      'The archive stopped before it finished. Nothing was saved. Try again, or select fewer files.',
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toEqual([]);
  });
});
