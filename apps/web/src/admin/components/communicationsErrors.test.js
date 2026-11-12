import { describe, expect, it } from 'vitest';
import { communicationsError } from './communicationsErrors.js';

describe('communicationsError', () => {
  it.each([
    [500, 'internal', 'Part of the send failed before it reached the email provider. Continue the send to try again.'],
    [500, 'internal', 'The send progress could not be saved. Continue the send; no recipient gets a second copy.'],
    [409, 'channel-changed', 'The announcement stream or its unsubscribe handling changed after this send started. Restore it, then continue the send.'],
    [502, 'delivery-unknown', 'We do not know if the email went out. Check the Email log before you send it again. The decision is still saved.'],
    [503, 'unavailable', 'Invoices could not complete this action. Reload the invoice before trying again.'],
    [502, 'send-failed', 'This email was not sent. Preview the email again to try again.'],
    [503, 'email-unavailable', 'Email is not set up for this site, so the invoice was not emailed. Download the PDF instead.'],
  ])('keeps the recovery in a %s %s server response', (status, code, message) => {
    expect(communicationsError({ status, code, message }, 'Preview the email again.')).toBe(message);
  });

  it('keeps the safe fallback for an unexpected client failure', () => {
    expect(communicationsError(new Error('Unexpected client failure'), 'The action could not finish. Try again.'))
      .toBe('The action could not finish. Try again.');
  });

  it.each([
    [{ status: 401, code: 'unauthorized', message: 'Authentication required.' }, 'Your session has expired. Sign in again.'],
    [{ status: 403, code: 'forbidden', message: 'Not allowed.' }, 'You do not have access. Ask an event administrator for access.'],
    [{ status: 409, code: 'preview-stale', message: 'The audience or the email changed after the preview.' }, 'The message or recipients changed. Preview the email again before sending.'],
  ])('keeps the existing access and stale-preview guidance', (error, expected) => {
    expect(communicationsError(error)).toBe(expected);
  });
});
