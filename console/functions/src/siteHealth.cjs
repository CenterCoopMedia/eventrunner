'use strict';

const { CONSOLE_REQUEST_GROUPS } = require('shared/consoleRequest');
const { notifyOperators } = require('./applicationStatus.cjs');
const { reviewedAnswers } = require('./reviewAccess.cjs');
const { toMillis } = require('./access.cjs');

async function answer(fetch, url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel();
    return { ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

/** Public HTTP reads only, on recorded platform hosts; no credentials or response text. */
async function checkSiteHealth(deps) {
  const { db, fetch = globalThis.fetch, now = Date.now, log = console } = deps;
  const apps = await db.collection('applications').where('status', 'in', CONSOLE_REQUEST_GROUPS.built).get();
  for (const doc of apps.docs) {
    try {
      const ref = db.collection('console_builds').doc(doc.id);
      const snap = await ref.get();
      const domain = snap.data()?.resources?.domain;
      if (typeof domain !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}\.eventrunner\.org$/.test(domain)) continue;
      const [site, admin] = await Promise.all([answer(fetch, `https://${domain}/`), answer(fetch, `https://${domain}/admin/`)]);
      const at = new Date(now());
      const health = { site, admin, checkedAt: at };
      const recipients = await db.runTransaction(async (tx) => {
        const [currentApp, current] = await Promise.all([tx.get(doc.ref), tx.get(ref)]);
        if (!currentApp.exists || !CONSOLE_REQUEST_GROUPS.built.includes(currentApp.data().status) || current.data()?.resources?.domain !== domain) return null;
        const previous = current.data().health;
        const down = !site.ok || !admin.ok;
        const recentAttempt = now() - toMillis(previous?.noticeAttemptAt) < 10 * 60_000;
        const send = down && !previous?.notified && !recentAttempt;
        tx.update(ref, { health: { ...health, notified: down && previous?.notified === true,
          notifiedTo: down ? previous?.notifiedTo || [] : [],
          noticeAttemptAt: down ? (send ? at : previous?.noticeAttemptAt || null) : null } });
        return send ? previous?.notifiedTo || [] : null;
      });
      if (recipients) {
        const sent = await notifyOperators({ log, ...deps }, { orgId: doc.data().orgId, appId: doc.id,
          eventName: reviewedAnswers(doc.data())?.event?.name || domain, kind: 'site-unavailable',
          problem: `${domain}: ${!site.ok ? 'the site' : ''}${!site.ok && !admin.ok ? ' and ' : ''}${!admin.ok ? 'the admin page' : ''} did not answer successfully.`,
          skip: recipients,
          onSent: (to) => db.runTransaction(async (tx) => {
            const current = await tx.get(ref);
            if (toMillis(current.data()?.health?.noticeAttemptAt) === at.getTime()) {
              tx.update(ref, { health: { ...current.data().health, notifiedTo: [...new Set([...current.data().health.notifiedTo, to])] } });
            }
          }),
        });
        if (sent) await db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (toMillis(current.data()?.health?.noticeAttemptAt) === at.getTime()) tx.update(ref, { health: { ...current.data().health, notified: true } });
        });
      }
    } catch {
      log.error('console site health check failed');
    }
  }
}

module.exports = { checkSiteHealth };
