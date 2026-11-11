'use strict';

const { createHmac } = require('node:crypto');

const STRIPE_ROUTE_COLLECTION = 'console_stripe_routes';
const STRIPE_WEBHOOK_FUNCTION = 'stripeConnectWebhook';
const STRIPE_WEBHOOK_SECRET = 'CONSOLE_STRIPE_WEBHOOK_SECRET';
const routeSecretId = (appId) => `stripe-webhook-${appId}`;
const accountIdValid = (id) => typeof id === 'string' && /^acct_[A-Za-z0-9]+$/.test(id);

function ticketWebhookUrl({ appId, projectId, region }) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(appId || '')
      || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '')
      || !/^[a-z]+-[a-z]+[1-9][0-9]?$/.test(region || '')) {
    throw new Error('the Stripe route has an invalid site identity');
  }
  return `https://${region}-${projectId}.cloudfunctions.net/ticketingWebhook`;
}

/** One live connected account belongs to one site. Secrets never go in Firestore. */
async function registerStripeRoute({ db, secrets, appId, accountId, projectId, region, secret, recordRef }) {
  ticketWebhookUrl({ appId, projectId, region });
  if (!accountIdValid(accountId) || typeof secret !== 'string' || !secret) throw new Error('the Stripe route is incomplete');
  // Publish only after the destination's secret is available to the receiver.
  // Each application's secret has its own name, including competing builds.
  const secretId = routeSecretId(appId);
  if (await secrets.readSecret(secretId) !== secret) await secrets.writeSecret(secretId, secret);
  const routes = db.collection(STRIPE_ROUTE_COLLECTION);
  await db.runTransaction(async (tx) => {
    const ref = routes.doc(accountId);
    const [current, previous] = await Promise.all([tx.get(ref), tx.get(routes.where('appId', '==', appId))]);
    if (current.exists && (current.data().appId !== appId || current.data().projectId !== projectId)) {
      throw new Error('this Stripe account already routes to another site');
    }
    for (const doc of previous.docs) {
      if (doc.data().projectId !== projectId) throw new Error('the Stripe route belongs to another project');
    }
    for (const doc of previous.docs) if (doc.id !== accountId) tx.delete(doc.ref);
    tx.set(ref, { appId, projectId, region });
    tx.update(recordRef, { stripeRouteAccountId: accountId });
  });
}

async function stripeRoutes({ db, appId, projectId }) {
  const found = await db.collection(STRIPE_ROUTE_COLLECTION).where('appId', '==', appId).get();
  for (const doc of found.docs) {
    if (doc.data().projectId !== projectId) throw new Error('the Stripe route belongs to another project');
  }
  return found.docs;
}

/** Route deletion precedes secret deletion, so a failed cleanup cannot forward again. */
async function deleteStripeRoutes({ db, secrets, appId, projectId }) {
  await db.runTransaction(async (tx) => {
    const found = await tx.get(db.collection(STRIPE_ROUTE_COLLECTION).where('appId', '==', appId));
    for (const doc of found.docs) {
      if (doc.data().projectId !== projectId) throw new Error('the Stripe route belongs to another project');
    }
    for (const doc of found.docs) tx.delete(doc.ref);
  });
  await secrets.deleteSecret(routeSecretId(appId));
}

/** The platform's signed bytes are the only source of the routing account. */
function stripeConnectWebhook({ db, secrets, endpointSecret, fetch, now = Date.now }) {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('POST required');
    if (!endpointSecret) return res.status(503).send('Webhook unavailable');
    let event;
    try {
      if (!Buffer.isBuffer(req.rawBody) || !req.rawBody.length) throw new Error('raw body required');
      const { webhooks } = require('stripe');
      event = webhooks.constructEvent(req.rawBody, req.headers?.['stripe-signature'], endpointSecret, 300, undefined, now());
    } catch {
      return res.status(400).send('Invalid webhook signature');
    }
    if (!accountIdValid(event?.account) || event.livemode !== true) return res.status(400).send('Live connected account required');
    try {
      const route = (await db.collection(STRIPE_ROUTE_COLLECTION).doc(event.account).get()).data();
      if (!route) return res.status(404).send('Unknown connected account');
      const url = ticketWebhookUrl(route);
      const secret = await secrets.readSecret(routeSecretId(route.appId));
      if (!secret) return res.status(503).send('Destination unavailable');
      const timestamp = Math.floor(now() / 1000);
      const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(req.rawBody).digest('hex');
      // Never follow redirects: even a site's redirect must not receive another copy.
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
        body: req.rawBody,
      });
      await response.body?.cancel();
      if (!response.ok) return res.status(502).send('Destination refused webhook');
      return res.status(200).send('Received');
    } catch {
      // Stripe retries delivery; the destination already deduplicates event IDs.
      // Do not log provider bodies, signatures, secrets, or payment payloads.
      return res.status(502).send('Webhook delivery failed');
    }
  };
}

module.exports = {
  STRIPE_ROUTE_COLLECTION, STRIPE_WEBHOOK_FUNCTION, STRIPE_WEBHOOK_SECRET,
  deleteStripeRoutes, registerStripeRoute, routeSecretId, stripeConnectWebhook, stripeRoutes, ticketWebhookUrl,
};
