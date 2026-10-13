import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatTicketMoney, readCheckoutAttempt, rememberCheckoutAttempt, safeCheckoutUrl,
  safeStripeDashboardUrl, ticketingRequest,
} from './ticketingCommerce.js';
import { appCheckHeaders } from '../firebase.js';

describe('ticketing commerce transport and credentials', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(appCheckHeaders).mockResolvedValue({ 'X-Firebase-AppCheck': 'attestation' });
  });
  it('reads private order status with the current token, App Check, and no cache', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-synthetic' }) });
    const user = { getIdToken: vi.fn(async () => 'current-token') };
    await ticketingRequest('ticketingOrderStatus', { user, query: { orderId: 'order-synthetic' } });
    expect(fetch).toHaveBeenCalledWith('https://functions.example.test/ticketingOrderStatus?orderId=order-synthetic', expect.objectContaining({
      method: 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Authorization: 'Bearer current-token', 'X-Firebase-AppCheck': 'attestation' },
    }));
  });
  it('normalizes every unauthorized or unknown order 404 to one private response', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { code: 'not-found', message: 'Private purchaser data must not surface' } }) });
    await expect(ticketingRequest('ticketingOrderStatus', { query: { orderId: 'missing' } })).rejects.toMatchObject({ status: 404, message: expect.stringContaining('not available to this account') });
    await expect(ticketingRequest('ticketingOrderStatus', { query: { orderId: 'missing' } })).rejects.not.toMatchObject({ message: expect.stringContaining('Private purchaser data') });
  });
  it('refuses to fetch when the caller cannot obtain a fresh sign-in token', async () => {
    await expect(ticketingRequest('ticketingCheckout', { user: { getIdToken: async () => { throw new Error('expired'); } }, body: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('persists only identifiers and isolates saved attempts by account', () => {
    rememberCheckoutAttempt('owner-a', { requestId: 'request-synthetic-123', orderId: 'order-456', email: 'private@example.test', checkoutUrl: 'https://checkout.stripe.com/c/pay/secret' });
    expect(readCheckoutAttempt('owner-a')).toEqual({ requestId: 'request-synthetic-123', orderId: 'order-456' });
    expect(readCheckoutAttempt('owner-b')).toBeNull();
    expect(sessionStorage.getItem('eventrunner.ticket-checkout.owner-a')).not.toMatch(/private|checkoutUrl|secret/);
  });
  it('renders currency amounts in their own units', () => {
    expect(formatTicketMoney(2500, 'usd')).toBe('$25.00');
    expect(formatTicketMoney(25, 'JPY')).toMatch(/25/);
    expect(formatTicketMoney(1234, 'KWD')).toMatch(/1\.234/);
  });
  it('accepts trusted account-custom Checkout URLs and rejects unsafe transports or credentials', () => {
    expect(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_synthetic')).toBe('https://checkout.stripe.com/c/pay/cs_test_synthetic');
    expect(safeCheckoutUrl('https://checkout.events.example.org/c/pay/cs_test_synthetic')).toBe('https://checkout.events.example.org/c/pay/cs_test_synthetic');
    expect(safeStripeDashboardUrl('https://dashboard.stripe.com/acct_test/test/payments/pi_synthetic')).toContain('dashboard.stripe.com');
    for (const url of ['javascript:alert(1)', '/pay/cs_test_synthetic', 'https://someone@checkout.stripe.com/pay', 'https://checkout.stripe.com:8443/pay', 'http://checkout.stripe.com/pay']) expect(safeCheckoutUrl(url)).toBeNull();
    expect(safeStripeDashboardUrl('https://dashboard.stripe.com.evil.test')).toBeNull();
  });
});
