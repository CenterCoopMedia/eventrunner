// HTTP seam for the self-service ticket claim (issue #33, spec §3.3, §3.5).
//
// One endpoint: ticketingVerifyOrder { orderNumber } + Bearer ID token →
// { ok, claimed, registrationStatus }. Reached the same way the speaker
// invite pair is (see lib/speakerInvites.js): POST
// <functionsOrigin>/<name> with the App Check attestation attached when the
// deployment configured one.
//
// ticketingVerifyOrder answers the SAME 404 for every failure — unknown
// order, another event's order, a ticket belonging to a different address,
// an already-claimed ticket (functions/src/ticketing/registration.cjs) — on
// purpose, so a network log cannot be read as an oracle for any of those
// facts. This module preserves that: `code` is always 'not-found' for a
// 404, and the page renders one generic "no ticket matches" state rather
// than branching on which of those it might have been.
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { appCheckHeaders } from '../firebase.js';

/** Error shape ticketingVerifyOrder failures normalize to. */
export class TicketClaimError extends Error {
  constructor({ code, message, status }) {
    super(message);
    this.name = 'TicketClaimError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {{ orderNumber: string, idToken: string }} args
 * @returns {Promise<{ ok: true, claimed: number, registrationStatus: string|null }>}
 */
export async function verifyTicketOrder({ orderNumber, idToken }) {
  const attestation = await appCheckHeaders();
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/ticketingVerifyOrder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...attestation,
      },
      body: JSON.stringify({ orderNumber }),
    });
  } catch {
    throw new TicketClaimError({
      code: 'network',
      status: 0,
      message: 'We could not reach the server. Check your connection and try again.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null; // non-JSON body (proxy error page); fall through
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new TicketClaimError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Something went wrong. Try again.',
    });
  }
  return payload ?? { ok: true, claimed: 0, registrationStatus: null };
}
