import { hostName } from '../text.js';

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
    consent: 'By connecting, you authorize Event Runner to read your Eventbrite organizations, events, orders and attendees, and keep your chosen event’s orders and attendees for your site. You also authorize Event Runner to add a webhook to your Eventbrite account so your site hears about order and attendee changes. The orders and attendees stay in your site for you to use until the site is removed or you ask us to delete them. We use them only to run and improve your site. We do not sell them, profit from them, or use them for marketing.',
  },
});

/** What a client can do about a connected account while the setup is open. */
export const canDisconnectWords = (provider) => (provider === 'stripe'
  ? 'You can disconnect this account here at any time, except while we build your site.'
  : `You can disconnect this account here until you accept the agreement. After that, ask ${hostName()} to remove it from your site.`);

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
// Only status or Tickets, with Tickets' two known UI markers in either order.
const RETURN_PATH = /^\/organizations\/[\w-]+\/applications\/[\w-]+(?:\/tickets(?:\?(?:from=review(?:&check=1)?|check=1(?:&from=review)?))?)?$/;

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
