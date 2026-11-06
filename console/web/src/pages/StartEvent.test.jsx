import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { callApi } from '../api.js';
import { callsTo, serveApi } from '../test/application.js';
import { fakeAuth, renderPage } from '../test/renderPage.jsx';
import StartEvent from './StartEvent.jsx';

vi.mock('../api.js', () => ({ callApi: vi.fn() }));

const page = (path = '/start/l1#token=tok123', auth = fakeAuth()) => renderPage(<StartEvent />, {
  path,
  route: '/start/:linkId',
  auth,
  routes: {
    '/organizations/:orgId/applications/:appId/:step': 'Setup page',
    '/organizations/:orgId/applications/:appId': 'Status page',
  },
});

const refused = (code, message) => () => { throw Object.assign(new Error(message), { code }); };

describe('StartEvent', () => {
  it('prefills the name, lets the client change it, and opens the first setup step', async () => {
    serveApi({
      getSignupLink: { organizationName: 'Example Press', status: 'open' },
      redeemSignupLink: { orgId: 'o1', appId: 'a1' },
    });
    page();
    const field = await screen.findByLabelText('Organization name');
    expect(field).toHaveValue('Example Press');
    expect(callsTo('getSignupLink')).toEqual([{ linkId: 'l1', token: 'tok123' }]);
    expect(callsTo('redeemSignupLink')).toHaveLength(0);
    fireEvent.change(field, { target: { value: '  Example   Press News ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Setup page')).toBeInTheDocument();
    const [body] = callsTo('redeemSignupLink');
    expect(body).toMatchObject({ linkId: 'l1', token: 'tok123', organizationName: 'Example Press News' });
    expect(typeof body.timezone).toBe('string');
  });

  it('checks the name before it spends the link', async () => {
    serveApi({ getSignupLink: { organizationName: 'Example Press', status: 'open' } });
    page();
    const field = await screen.findByLabelText('Organization name');
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Enter a name of 2 to 100 characters.')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(callsTo('redeemSignupLink')).toHaveLength(0);
  });

  it('a link this user already used goes straight to the request', async () => {
    serveApi({ getSignupLink: { status: 'used', orgId: 'o1', appId: 'a1' } });
    page();
    expect(await screen.findByText('Status page')).toBeInTheDocument();
    expect(callsTo('redeemSignupLink')).toHaveLength(0);
  });

  it.each([
    ['link-invalid', 'This link is not valid. Ask for a new link.'],
    ['link-revoked', 'This link was revoked. Ask for a new link.'],
    ['link-expired', 'This link has expired. Ask for a new link.'],
  ])('shows the refusal %s with no form', async (code, message) => {
    serveApi({ getSignupLink: refused(code, message) });
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('a link someone else used shows who is signed in and offers to sign out', async () => {
    serveApi({ getSignupLink: refused('link-used', 'This link was already used. Ask for a new link.') });
    const auth = fakeAuth();
    page(undefined, auth);
    expect(await screen.findByRole('alert')).toHaveTextContent('already used');
    expect(screen.getByText(/You are signed in as ana@example\.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('a connection failure can be tried again', async () => {
    let calls = 0;
    serveApi({
      getSignupLink: () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('We could not reach the server.'), { code: 'network' });
        return { organizationName: 'Example Press', status: 'open' };
      },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Organization name')).toHaveValue('Example Press');
  });

  it('a link that stops working between load and submit takes the form away', async () => {
    serveApi({
      getSignupLink: { organizationName: 'Example Press', status: 'open' },
      redeemSignupLink: refused('link-revoked', 'This link was revoked. Ask for a new link.'),
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link was revoked.');
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
  });

  it('closed sign-ups keep the form, so the client can try again', async () => {
    serveApi({
      getSignupLink: { organizationName: 'Example Press', status: 'open' },
      redeemSignupLink: refused('signups-closed', 'This site is not taking sign-ups right now. Try again later.'),
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not taking sign-ups');
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('shows a server refusal of the name at the field', async () => {
    serveApi({
      getSignupLink: { organizationName: 'Example Press', status: 'open' },
      redeemSignupLink: () => { throw Object.assign(new Error('Enter an organization name of 2 to 100 characters.'), { code: 'bad-request', field: 'organizationName' }); },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Enter an organization name of 2 to 100 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('says to open the emailed link again when it has no token, and calls nothing', () => {
    page('/start/l1');
    expect(screen.getByRole('alert')).toHaveTextContent('Open the signup link in your email again');
    expect(callApi).not.toHaveBeenCalled();
  });
});
