'use strict';

const { notifySubmissionOnce } = require('shared/operatorAlert');
const { createSubmissionNotifier } = require('./operator.cjs');
const { internals: { notifierSecretNames } } = require('../telemetry/systemErrors.cjs');

function buildHandlers() {
  const { onDocumentCreated } = require('firebase-functions/v2/firestore');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = notifierSecretNames(process.env).map(defineSecret);
  const onSubmission = (collection, kind) => onDocumentCreated({
    document: `${collection}/{id}`, region, secrets, timeoutSeconds: 30,
  }, async (event) => {
    const ref = event.data?.ref;
    if (!ref) return;
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getEmailProvider } = require('../email/providers/index.cjs');
    const { createEmailCore } = require('../email/send.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    const sendEmail = (message) => createEmailCore({
      db, provider: getEmailProvider({ env: process.env }), getConfig,
    }).send(message);
    const notify = createSubmissionNotifier({ getConfig, sendEmail });
    if (!notify) return;
    await notifySubmissionOnce({
      db, ref,
      notify: ({ page, screenshotDigests }) => notify({ kind, id: ref.id, page, screenshotCount: screenshotDigests?.length ?? 0 }),
    });
  });
  return {
    onFeedbackOperatorAlert: onSubmission('feedback', 'feedback'),
    onChangeRequestOperatorAlert: onSubmission('change_requests', 'change-request'),
  };
}

module.exports = { get handlers() { return buildHandlers(); } };
