'use strict';

// Native commerce endpoints need payment secrets only. Constructing the broad
// ticketing notifier/email dependencies would require unrelated send secrets on
// an attendee's read request.
function buildCommerceDeps() {
  const { getDb } = require('../core/firestore.cjs');
  const { getEventConfig } = require('../core/config.cjs');
  const { getAuth } = require('firebase-admin/auth');
  const { getTicketingProvider } = require('./providers/index.cjs');
  const db = getDb();
  const getConfig = () => getEventConfig({ db });
  return { db, getConfig, auth: getAuth(), provider: getTicketingProvider({ db, getConfig, env: process.env }), env: process.env };
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
    await factory(buildCommerceDeps())(req, res);
  });
  return {
    ticketingCatalog: wrap(checkout.createTicketingCatalogHandler, ['GET']),
    ticketingCheckout: wrap(checkout.createTicketingCheckoutHandler, ['POST']),
    ticketingOrderStatus: wrap(checkout.createTicketingOrderStatusHandler, ['GET', 'POST']),
  };
}

module.exports = { buildCommerceDeps, get handlers() { return buildHandlers(); } };
