'use strict';

/**
 * Deploy wiring: each console action becomes one HTTP function. The web
 * app calls them at `/api/<name>` through the Hosting rewrites in
 * console/firebase.json. Nothing here runs in the unit tests except the
 * shape check in handlers.test.cjs; the actions take every dependency as
 * an argument.
 *
 * Settings (console project only, never a client project):
 *   CONSOLE_PUBLIC_URL       the console address, for invite links
 *   CONSOLE_MAIL_FROM        the sender of invite emails
 *   CONSOLE_ALLOWED_ORIGINS  extra origins for a local dev server
 *   CONSOLE_REGION           defaults to us-central1
 *   CONSOLE_POSTMARK_TOKEN   secret: the Postmark server token
 */

const { applyCors, parseAllowedOrigins, postEndpoint } = require('./http.cjs');
const { createOrganization, getTeam, listOrganizations } = require('./organizations.cjs');
const { acceptInvite, inviteMember } = require('./invites.cjs');
const { changeMemberRole, removeMember } = require('./members.cjs');

const ENDPOINTS = Object.freeze({
  listOrganizations: { action: listOrganizations },
  createOrganization: { action: createOrganization },
  getTeam: { action: getTeam },
  inviteMember: { action: inviteMember, mail: true },
  acceptInvite: { action: acceptInvite },
  changeMemberRole: { action: changeMemberRole },
  removeMember: { action: removeMember },
});

let services = null;
function adminServices() {
  if (!services) {
    const { getApps, initializeApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { getAuth } = require('firebase-admin/auth');
    if (getApps().length === 0) initializeApp();
    services = { db: getFirestore(), auth: getAuth() };
  }
  return services;
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { createPostmarkMailer } = require('./mailer.cjs');

  const region = (process.env.CONSOLE_REGION || '').trim() || 'us-central1';
  const postmarkToken = defineSecret('CONSOLE_POSTMARK_TOKEN');

  const handlers = {};
  for (const [name, spec] of Object.entries(ENDPOINTS)) {
    const options = { region, ...(spec.mail ? { secrets: [postmarkToken] } : {}) };
    handlers[name] = onRequest(options, async (req, res) => {
      if (applyCors(req, res, parseAllowedOrigins(process.env.CONSOLE_ALLOWED_ORIGINS))) return;
      const { db, auth } = adminServices();
      const deps = { db, auth, now: Date.now, log: console, publicUrl: (process.env.CONSOLE_PUBLIC_URL || '').replace(/\/+$/, '') };
      if (spec.mail) {
        // Made at send time, so a missing setting is a failed send that the
        // action reports and logs, not a crash before the request is read.
        deps.mailer = {
          sendInvite: (invite) => createPostmarkMailer({
            token: postmarkToken.value(),
            from: process.env.CONSOLE_MAIL_FROM || '',
            fetch: globalThis.fetch,
          }).sendInvite(invite),
        };
      }
      await postEndpoint(deps, (input) => spec.action(deps, input))(req, res);
    });
  }
  return handlers;
}

module.exports = { ENDPOINTS, buildHandlers };
