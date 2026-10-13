'use strict';

// Native commerce endpoints need payment secrets only. Constructing the broad
// ticketing notifier/email dependencies would require unrelated send secrets on
// an attendee's read request.
function buildCommerceDeps() {
  const { getDb } = require('../core/firestore.cjs');
  const { getEventConfig } = require('../core/config.cjs');
  const { getAuth } = require('firebase-admin/auth');
  const { getTicketingProvider, PROVIDER_NAMES } = require('./providers/index.cjs');
  const db = getDb();
  const getConfig = () => getEventConfig({ db });
  const name = process.env.EVENT_TICKETING_PROVIDER?.trim();
  if (!PROVIDER_NAMES.includes(name)) throw new Error('Ticketing provider configuration is unavailable.');
  // These endpoints serve native commerce only. A legacy deployment can
  // report a closed catalog without constructing its unrelated adapter.
  const provider = name === 'stripe' ? getTicketingProvider({ db, getConfig, env: process.env }) : { name };
  return { db, getConfig, auth: getAuth(), provider, env: process.env };
}

async function invokeCommerceHandler(factory, req, res) {
  try {
    await factory(buildCommerceDeps())(req, res);
  } catch (err) {
    console.error('Ticket commerce request is unavailable.', { name: err?.name || 'Error' });
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ error: { code: 'ticketing-unavailable', message: 'Ticketing is temporarily unavailable. Try again later.' } });
  }
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const checkout = require('./stripeCheckout.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = ticketingSecretNames(process.env).map(defineSecret);
  const wrap = (factory, methods) => onRequest({ region, secrets }, async (req, res) => {
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods })) return;
    await invokeCommerceHandler(factory, req, res);
  });
  return {
    ticketingCatalog: wrap(checkout.createTicketingCatalogHandler, ['GET']),
    ticketingCheckout: wrap(checkout.createTicketingCheckoutHandler, ['POST']),
    ticketingOrderStatus: wrap(checkout.createTicketingOrderStatusHandler, ['GET', 'POST']),
  };
}

module.exports = { buildCommerceDeps, invokeCommerceHandler, get handlers() { return buildHandlers(); } };
