import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { renderPage } from '../../test/renderPage.jsx';
import SignupLinks from './SignupLinks.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

const URL_ONE = 'https://console.example/start/l9#token=secret-token';
const OPEN = {
  id: 'l1', organizationName: 'Open Org', status: 'open', createdAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z',
};
const USED = {
  id: 'l2', organizationName: 'Used Org', status: 'used', createdAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-31T00:00:00.000Z',
  usedEmail: 'ana@example.org', usedAt: '2026-10-02T00:00:00.000Z', orgId: 'o2', appId: 'a2',
};
const NEW = { id: 'l9', organizationName: 'New Org', status: 'open', createdAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-12-04T00:00:00.000Z' };

function serve(handlers = {}) {
  callApi.mockImplementation(async (name, body) => {
    if (handlers[name]) return handlers[name](body);
    if (name === 'listSignupLinks') return { links: [OPEN, USED] };
    return {};
  });
}

const page = () => renderPage(<SignupLinks />, { path: '/review/links', route: '/review/links' });

function create(name = 'New Org') {
  fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
}

beforeEach(() => serve());

describe('SignupLinks', () => {
  it('lists the links with their status, and Revoke only on an open one', async () => {
    page();
    const items = within(await screen.findByRole('list', { name: 'Links' })).getAllByRole('listitem');
    expect(callApi).toHaveBeenCalledWith('listSignupLinks', {});
    expect(items[0]).toHaveTextContent('Open Org');
    expect(items[0]).toHaveTextContent('Open');
    expect(within(items[0]).getByRole('button', { name: /^Revoke link for / })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('Used by ana@example.org');
    expect(within(items[1]).queryByRole('button', { name: /^Revoke link for / })).not.toBeInTheDocument();
    expect(within(items[1]).getByRole('link', { name: 'Open the request' })).toHaveAttribute('href', '/review/a2');
  });

  it('shows a new link once, with Copy and a note, and never again', async () => {
    serve({ createSignupLink: () => ({ link: NEW, url: URL_ONE }) });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { unmount } = page();
    await screen.findByRole('list', { name: 'Links' });
    create();
    const field = await screen.findByLabelText('Signup link');
    expect(field).toHaveTextContent(URL_ONE);
    expect(callApi).toHaveBeenCalledWith('createSignupLink', { organizationName: 'New Org' });
    expect(screen.getByText(/Save this link before leaving/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy signup link' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL_ONE);
    unmount();
    page();
    await screen.findByRole('list', { name: 'Links' });
    expect(screen.queryByLabelText('Signup link')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-token');
  });

  it('says to copy by hand when the browser refuses', async () => {
    serve({ createSignupLink: () => ({ link: NEW, url: URL_ONE }) });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    page();
    await screen.findByRole('list', { name: 'Links' });
    create();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy signup link' }));
    expect(await screen.findByText(/Select the link and copy it/)).toBeInTheDocument();
  });

  it('checks the name first', async () => {
    page();
    await screen.findByRole('list', { name: 'Links' });
    create('x');
    expect(await screen.findByText('Enter a name of 2 to 100 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveFocus();
    expect(callApi).not.toHaveBeenCalledWith('createSignupLink', expect.anything());
  });

  it('when sign-ups are closed, shows the message and a link to the settings', async () => {
    serve({ createSignupLink: () => { throw Object.assign(new Error('Sign-ups are closed. Missing: region.'), { code: 'signups-closed' }); } });
    page();
    await screen.findByRole('list', { name: 'Links' });
    create();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-ups are closed.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Missing: region.');
    expect(screen.getByRole('link', { name: 'Save hosting settings and an agreement' })).toHaveAttribute('href', '/review/settings');
    expect(screen.queryByLabelText('Signup link')).not.toBeInTheDocument();
  });

  it('revokes after one question, and Cancel keeps the link', async () => {
    let links = [OPEN];
    serve({
      listSignupLinks: () => ({ links }),
      revokeSignupLink: () => { links = [{ ...OPEN, status: 'revoked' }]; return {}; },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: /^Revoke link for / }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(callApi).not.toHaveBeenCalledWith('revokeSignupLink', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /^Revoke link for / }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('You revoked the link for Open Org.')).toBeInTheDocument();
    expect(callApi).toHaveBeenCalledWith('revokeSignupLink', { linkId: 'l1' });
    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Revoke link for / })).not.toBeInTheDocument();
  });

  it('takes a revoked new link off the page', async () => {
    let links = [OPEN];
    serve({
      listSignupLinks: () => ({ links }),
      createSignupLink: () => { links = [NEW, OPEN]; return { link: NEW, url: URL_ONE }; },
      revokeSignupLink: () => { links = [{ ...NEW, status: 'revoked' }, OPEN]; return {}; },
    });
    page();
    await screen.findByRole('list', { name: 'Links' });
    create();
    await screen.findByLabelText('Signup link');
    const item = within(await screen.findByRole('list', { name: 'Links' })).getByText('New Org').closest('li');
    fireEvent.click(within(item).getByRole('button', { name: /^Revoke link for / }));
    fireEvent.click(within(item).getByRole('button', { name: 'Revoke' }));
    await screen.findByText('You revoked the link for New Org.');
    expect(screen.queryByLabelText('Signup link')).not.toBeInTheDocument();
  });

  it('tells a client the page is for the hosting team', async () => {
    callApi.mockRejectedValue(Object.assign(new Error('x'), { code: 'not-operator' }));
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'This page is for the hosting team' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
  });
});
