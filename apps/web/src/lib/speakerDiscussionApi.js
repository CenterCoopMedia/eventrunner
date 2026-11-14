import { validateDiscussionPoints } from 'shared/speakerDiscussion';
import { AdminApiError, callAdminEndpoint } from '../admin/adminApi.js';

const NOTIFICATION_STATES = ['accepted', 'omitted', 'failed', 'unknown'];

function unresolvedResponse() {
  return new AdminApiError({
    code: 'unresolved-response', status: 0,
    message: 'The server response could not be confirmed. Load the current submission or retry the previous request.',
  });
}

function submissionOf(payload, allowEmpty) {
  if (allowEmpty && payload?.submission === null) return null;
  const submission = payload?.submission;
  const validation = validateDiscussionPoints({
    text: submission?.text,
    expectedRevision: submission?.revision - 1,
    requestId: submission?.requestId,
  });
  if (!validation.ok || !Number.isSafeInteger(submission?.revision) || submission.revision < 1
      || validation.fields.text !== submission.text
      || typeof submission.submittedAt !== 'string'
      || !Number.isFinite(Date.parse(submission.submittedAt))
      || !NOTIFICATION_STATES.includes(submission.notification?.state)) {
    throw unresolvedResponse();
  }
  return submission;
}

function tokenGetter(user) {
  return () => user?.getIdToken ? user.getIdToken() : Promise.reject(new Error('not signed in'));
}

export async function getSpeakerDiscussionPoints({ user, speakerId }) {
  return submissionOf(await callAdminEndpoint(
    'getSpeakerDiscussionPoints', { speakerId }, tokenGetter(user),
  ), true);
}

export async function saveSpeakerDiscussionPoints({ user, ...request }) {
  const submission = submissionOf(await callAdminEndpoint(
    'saveSpeakerDiscussionPoints', request, tokenGetter(user),
  ), false);
  if (submission.requestId !== request.requestId || submission.text !== request.text
      || submission.revision !== request.expectedRevision + 1) throw unresolvedResponse();
  return submission;
}
