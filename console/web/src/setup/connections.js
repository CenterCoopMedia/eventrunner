// The words and checks for connecting a client's own Stripe or Eventbrite
// account (ADR 0007 §4). The server does the connecting; this file holds
// what the client reads and where the browser may go.

export const PROVIDER_COPY = Object.freeze({
  stripe: {
    name: 'Stripe',
    button: 'Connect with Stripe',
    host: 'connect.stripe.com',
    explain: 'You own this account, and the money from ticket sales goes straight to it. If you do not have a Stripe account yet, Stripe helps you make one.',
  },
  eventbrite: {
    name: 'Eventbrite',
    button: 'Connect with Eventbrite',
    host: 'www.eventbrite.com',
    explain: 'You own this account, and the money from ticket sales goes to you as it does now. Your site shows the tickets people buy on Eventbrite.',
    consent: 'By connecting, you authorize Event Runner to read your Eventbrite organizations, events, orders and attendees, to keep the orders and attendees for the event you choose in order to run your site, and to add a webhook that tells your site about changes. We keep that data with your site after the event until the site is removed or you ask us to delete it.',
  },
});

export const CAN_DISCONNECT = 'You can disconnect this account at any time until we build your site.';

/** The server names the provider's page; the browser goes only to that provider. */
export function isProviderUrl(url, provider) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.host === PROVIDER_COPY[provider]?.host;
  } catch {
    return false;
  }
}

const RETURN_KEY = 'console.connectReturn';
// Only the status page or the tickets step of a request.
const RETURN_PATH = /^\/organizations\/[\w-]+\/applications\/[\w-]+(\/tickets)?$/;

/** Where to come back to from the provider's page. */
export function rememberConnectReturn(path) {
  try {
    window.sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Without storage the return page uses the request's tickets step.
  }
}

/** The remembered path, once, and only a path this page may go to. */
export function takeConnectReturn() {
  try {
    const path = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    return typeof path === 'string' && RETURN_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}
