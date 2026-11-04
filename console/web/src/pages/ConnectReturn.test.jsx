import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, callApi } from '../api.js';
import { isProviderUrl, rememberConnectReturn, takeConnectReturn } from '../setup/connections.js';
import { callsTo } from '../test/application.js';
import ConnectReturn from './ConnectReturn.jsx';

vi.mock('../api.js', async (importOriginal) => ({ ...(await importOriginal()), callApi: vi.fn() }));

const TICKETS = '/organizations/o1/applications/a1/tickets';
const DONE = { connected: true, provider: 'stripe', orgId: 'o1', appId: 'a1' };

/** A stand-in page that shows where the reader landed and what they were told. */
function Landed() {
  const { pathname, search, state } = useLocation();
  return <p>Landed {pathname}{search}: {state?.connectionMessage?.kind}: {state?.connectionMessage?.text}</p>;
}

function SeeAddress({ onAddress }) {
  const { pathname, search } = useLocation();
  useEffect(() => { onAddress(`${pathname}${search}`); });
  return null;
}

function renderReturn(query, { provider = 'stripe', onAddress = () => {} } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/connect/${provider}/return${query}`]}>
      <SeeAddress onAddress={onAddress} />
      <Routes>
        <Route path="/connect/:provider/return" element={<ConnectReturn />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  callApi.mockReset();
  window.sessionStorage.clear();
});

describe('Coming back from a provider', () => {
  it('hands the code and state to the server once, takes them out of the address, and returns to the step', async () => {
    callApi.mockResolvedValue(DONE);
    rememberConnectReturn(TICKETS);
    const addresses = [];
    renderReturn('?code=c1&state=s1', { onAddress: (a) => addresses.push(a) });
    expect(await screen.findByText(`Landed ${TICKETS}: success: Your Stripe account is connected.`)).toBeInTheDocument();
    expect(callsTo('completeConnection')).toEqual([{ provider: 'stripe', state: 's1', code: 'c1' }]);
    await waitFor(() => expect(addresses.at(-1)).toBe(TICKETS));
    expect(addresses.slice(1).some((a) => a.includes('c1'))).toBe(false);
  });

  it('with no remembered page, goes to the request the server names', async () => {
    callApi.mockResolvedValue(DONE);
    renderReturn('?code=c1&state=s1');
    expect(await screen.findByText(new RegExp(`Landed ${TICKETS}`))).toBeInTheDocument();
  });

  it('a client who said no goes back to the step with no alarm, and no code is sent', async () => {
    callApi.mockResolvedValue({ ...DONE, connected: false });
    rememberConnectReturn(TICKETS);
    renderReturn('?error=access_denied&state=s1');
    expect(await screen.findByText(`Landed ${TICKETS}: info: You did not connect your Stripe account. You can try again when you are ready.`)).toBeInTheDocument();
    expect(callsTo('completeConnection')).toEqual([{ provider: 'stripe', state: 's1', denied: true }]);
  });

  it('a mismatch shows the plain message on the step', async () => {
    callApi.mockRejectedValue(new ApiError(400, 'state-mismatch', 'We could not match this to your request, or it took too long. Connect the account again.'));
    rememberConnectReturn(TICKETS);
    renderReturn('?code=c1&state=wrong');
    expect(await screen.findByText(/Landed .*tickets: error: We could not match this/)).toBeInTheDocument();
  });

  it('a mismatch with no remembered page shows the message here, with a way out', async () => {
    callApi.mockRejectedValue(new ApiError(400, 'state-mismatch', 'We could not match this to your request.'));
    renderReturn('?code=c1&state=wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not match this to your request.');
    expect(screen.getByRole('link', { name: 'Go to your organizations' })).toHaveAttribute('href', '/');
  });
});

describe('Where the browser may go', () => {
  it('remembers only a request page inside the console, once', () => {
    rememberConnectReturn(TICKETS);
    expect(takeConnectReturn()).toBe(TICKETS);
    expect(takeConnectReturn()).toBe(null);
    rememberConnectReturn('/organizations/o1/applications/a1');
    expect(takeConnectReturn()).toBe('/organizations/o1/applications/a1');
    for (const path of ['https://evil.example', '//evil.example', '/signin', '/organizations/o1/applications/a1/../../x', TICKETS.replace('tickets', 'email')]) {
      rememberConnectReturn(path);
      expect(takeConnectReturn(), path).toBe(null);
    }
  });

  it('goes only to the provider\'s own https page', () => {
    expect(isProviderUrl('https://connect.stripe.com/oauth/authorize?x=1', 'stripe')).toBe(true);
    expect(isProviderUrl('https://www.eventbrite.com/oauth/authorize', 'eventbrite')).toBe(true);
    for (const [url, provider] of [
      ['http://connect.stripe.com/oauth', 'stripe'],
      ['https://connect.stripe.com.evil.example/', 'stripe'],
      ['https://evil.example/connect.stripe.com', 'stripe'],
      ['https://www.eventbrite.com/', 'stripe'],
      ['javascript:alert(1)', 'stripe'],
      ['not a url', 'stripe'],
      ['https://connect.stripe.com/', 'nope'],
    ]) {
      expect(isProviderUrl(url, provider), url).toBe(false);
    }
  });
});
