'use strict';

/**
 * The provider HTTP calls behind "Connect with Stripe" and "Connect with
 * Eventbrite" (ADR 0007 §4, ADR 0004 amendment 2026-11-03). `fetch` is
 * injected, so tests make no network call.
 *
 * A connector has:
 *   authorizeUrl({ state, redirectUri }) -> the provider's page to send the client to
 *   exchangeCode({ code, redirectUri }) -> { token, accountId, displayName, details }
 *   revoke(accountId) -> true when the provider ended the connection, false when it has no way to
 *   listEvents(token) -> the client's events (Eventbrite only)
 *
 * Every error here is safe to log: it names the provider, the step, the HTTP
 * status and the provider's short error code. It never holds a response body.
 * Stripe puts the authorization code in its `error_description`.
 */

const TIMEOUT_MS = 10_000;
const STRIPE_CONNECT = 'https://connect.stripe.com';
const STRIPE_API = 'https://api.stripe.com/v1';
const EVENTBRITE = 'https://www.eventbrite.com';
const EVENTBRITE_API = 'https://www.eventbriteapi.com/v3';
// The same shapes the event site requires: functions/src/ticketing/providers/stripe.cjs.
const STRIPE_KEY = /^(?:sk|rk)_(live|test)_[A-Za-z0-9]+$/;
const STRIPE_ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const ERROR_CODE = /^[A-Za-z_]{1,64}$/;
const MAX_PAGES = 5;
const NAME_MAX = 200;
// The events a client can still run tickets for.
const EVENT_FILTERS = Object.freeze({ status: 'draft,live,started', time_filter: 'current_future', order_by: 'start_asc', page_size: '50' });

const shortName = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, NAME_MAX) : null);

async function request(fetch, label, url, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`${label}: no answer`);
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = typeof body?.error === 'string' && ERROR_CODE.test(body.error) ? ` ${body.error}` : '';
    const err = new Error(`${label}: HTTP ${response.status}${code}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function createStripeConnector({ clientId, secretKey, fetch }) {
  const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  const post = (path, label, fields) => request(fetch, label, `${STRIPE_CONNECT}${path}`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  /** A half-made connection: the caller revokes `accountId` unless it was connected before. */
  const unusable = (accountId, why) => Object.assign(new Error(`stripe exchange: ${why}`), { accountId });

  return {
    authorizeUrl: ({ state, redirectUri }) => withQuery(`${STRIPE_CONNECT}/oauth/authorize`, {
      response_type: 'code', client_id: clientId, scope: 'read_write', redirect_uri: redirectUri, state,
    }),

    async exchangeCode({ code }) {
      const answer = await post('/oauth/token', 'stripe exchange', { grant_type: 'authorization_code', code });
      const accountId = answer?.stripe_user_id;
      if (typeof accountId !== 'string' || !STRIPE_ACCOUNT.test(accountId)) throw new Error('stripe exchange: no account id');
      // ADR 0004 needs the per-account token. Stripe's reference marks the
      // field deprecated, so this refuses an answer without a usable one.
      const token = answer.access_token;
      const mode = typeof token === 'string' ? token.match(STRIPE_KEY)?.[1] : null;
      if (!mode) throw unusable(accountId, 'no usable account token');
      if ((mode === 'live') !== (answer.livemode === true)) throw unusable(accountId, 'token does not match the mode');
      if (answer.scope !== 'read_write') throw unusable(accountId, 'not read_write');
      let account = null;
      try {
        account = await request(fetch, 'stripe account', `${STRIPE_API}/account`, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // The name is a courtesy. The site's own account check runs later.
      }
      if (account && account.id !== accountId) throw unusable(accountId, 'token answers for another account');
      return {
        token,
        accountId,
        displayName: shortName(account?.settings?.dashboard?.display_name) || shortName(account?.business_profile?.name),
        details: { livemode: answer.livemode === true },
      };
    },

    async revoke(accountId) {
      await post('/oauth/deauthorize', 'stripe revoke', { client_id: clientId, stripe_user_id: accountId });
      return true;
    },
  };
}

function createEventbriteConnector({ clientId, clientSecret, fetch }) {
  const get = (path, label, token) => request(fetch, label, `${EVENTBRITE_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  /** Follow the continuation token, up to a fixed number of pages. */
  async function allPages(path, params, key, token) {
    const rows = [];
    let continuation = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ ...params, ...(continuation ? { continuation } : {}) }).toString();
      const answer = await get(`${path}${query ? `?${query}` : ''}`, `eventbrite list ${key}`, token);
      rows.push(...(Array.isArray(answer?.[key]) ? answer[key] : []));
      continuation = answer?.pagination?.has_more_items === true ? answer.pagination.continuation : null;
      if (typeof continuation !== 'string' || !continuation) break;
    }
    return rows;
  }

  return {
    authorizeUrl: ({ state, redirectUri }) => withQuery(`${EVENTBRITE}/oauth/authorize`, {
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state,
    }),

    async exchangeCode({ code, redirectUri }) {
      const answer = await request(fetch, 'eventbrite exchange', `${EVENTBRITE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri,
        }).toString(),
      });
      const token = answer?.access_token;
      if (typeof token !== 'string' || !token) throw new Error('eventbrite exchange: no token');
      const me = await get('/users/me/', 'eventbrite user', token);
      if (me?.id === undefined || me?.id === null) throw new Error('eventbrite user: no id');
      return { token, accountId: String(me.id), displayName: shortName(me.name), details: {} };
    },

    // Eventbrite documents no way to end a connection from our side. The
    // client can remove the app in its own account settings.
    revoke: async () => false,

    async listEvents(token) {
      const organizations = await allPages('/users/me/organizations/', {}, 'organizations', token);
      const events = [];
      for (const organization of organizations) {
        const path = `/organizations/${encodeURIComponent(organization.id)}/events/`;
        for (const event of await allPages(path, EVENT_FILTERS, 'events', token)) {
          events.push({
            id: String(event.id),
            name: shortName(event.name?.text) || 'Untitled event',
            start: shortName(event.start?.local) || shortName(event.start?.utc),
            organizationId: String(organization.id),
          });
        }
      }
      return events;
    },
  };
}

/** Which providers the console has set up. Client ids are not secret, so every function can read them. */
function connectionsAvailable(env) {
  const site = Boolean(env.CONSOLE_PUBLIC_URL);
  return { stripe: site && Boolean(env.CONSOLE_STRIPE_CLIENT_ID), eventbrite: site && Boolean(env.CONSOLE_EVENTBRITE_CLIENT_ID) };
}

/** @returns {{ stripe: object|null, eventbrite: object|null }} null for a provider with no settings */
function createConnectors({ env, stripeSecretKey, eventbriteClientSecret, fetch }) {
  return {
    stripe: env.CONSOLE_STRIPE_CLIENT_ID && stripeSecretKey
      ? createStripeConnector({ clientId: env.CONSOLE_STRIPE_CLIENT_ID, secretKey: stripeSecretKey, fetch })
      : null,
    eventbrite: env.CONSOLE_EVENTBRITE_CLIENT_ID && eventbriteClientSecret
      ? createEventbriteConnector({ clientId: env.CONSOLE_EVENTBRITE_CLIENT_ID, clientSecret: eventbriteClientSecret, fetch })
      : null,
  };
}

module.exports = { connectionsAvailable, createConnectors, createEventbriteConnector, createStripeConnector };
