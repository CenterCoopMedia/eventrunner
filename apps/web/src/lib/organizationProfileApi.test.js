// The representative's own organization (issue #334): the same wire shape
// as the admin API, against ownOrganizationProfile, an endpoint a
// non-admin calls about the one organization its grant names.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOwnOrganization, submitOrganizationEdit } from './organizationProfileApi.js';

const user = { getIdToken: async () => 'id-token' };

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('getOwnOrganization', () => {
  it('asks for the caller’s own organization and names none itself', async () => {
    const body = { organizationId: 'beacon-fund', organization: { name: 'Beacon Fund' }, pending: null };
    fetch.mockResolvedValueOnce(response(200, body));
    expect(await getOwnOrganization({ user })).toEqual(body);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/ownOrganizationProfile$/);
    expect(init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ action: 'get' });
  });

  it('keeps the server’s refusal code, so the page can say the account represents nothing', async () => {
    fetch.mockResolvedValueOnce(response(403, { error: { code: 'not-representative', message: 'No.' } }));
    await expect(getOwnOrganization({ user })).rejects.toMatchObject({ code: 'not-representative', status: 403 });
  });
});

describe('submitOrganizationEdit', () => {
  it('sends only the fields it is given, with no organization id', async () => {
    fetch.mockResolvedValueOnce(response(200, { organizationId: 'beacon-fund', pending: null }));
    await submitOrganizationEdit({ user, fields: { description: 'New.', bio: '', url: null } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: 'submit',
      fields: { description: 'New.', bio: '', url: null },
    });
  });

  it('refuses without a signed-in user and sends nothing', async () => {
    await expect(submitOrganizationEdit({ user: null, fields: { bio: 'x' } })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
