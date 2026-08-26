// HTTP seam for the speaker invite pipeline (issue #21, spec §4.3).
//
// Two endpoints, both reached the same way the OTP pair is (see
// AuthContext.jsx): POST <functionsOrigin>/<name> with the App Check
// attestation attached when the deployment configured one.
//
//   validateSpeakerInvite  { token } → { valid, reason? , speakerName, … }
//   acceptSpeakerInvite    { token } + Bearer ID token → { speakerId, … }
//
// validateSpeakerInvite answers 200 for a miss as well as a hit — the server
// deliberately gives every failure the same status so a network log cannot
// be read as an oracle — so `valid` is the field to branch on, not
// `response.ok`.
import { functionsOrigin } from '../contexts/AuthContext.jsx';
import { appCheckHeaders } from '../firebase.js';
import { IS_DEMO } from './demoMode.js';

/**
 * Error shape both calls normalize to. `code` mirrors the server's
 * `error.code` ('link-occupied', 'account-not-ready', 'invite-expired',
 * 'invite-invalid', …) plus 'network' for a fetch that never landed.
 */
export class SpeakerInviteError extends Error {
  constructor({ code, message, status, invitedEmailMasked = null }) {
    super(message);
    this.name = 'SpeakerInviteError';
    this.code = code;
    this.status = status;
    // Only `email-mismatch` carries it: the masked address the invitation
    // went to, so the page can name the inbox to sign in from without
    // printing the address into a page opened from a travelling link.
    this.invitedEmailMasked = invitedEmailMasked;
  }
}

async function post(name, body, { idToken = null } = {}) {
  // Static demo build: there is no functions origin behind it, and unlike
  // Firestore (taken offline wholesale in firebase.js) a bare fetch has
  // nothing switching it off. Refusing here is what makes the claim true at
  // the seam rather than only at each call site: /speaker/accept is reached
  // from an emailed link, so a `?token=` deep link into the demo would
  // otherwise POST that token to a cloudfunctions.net host that is not ours.
  // pages/SpeakerAccept.jsx never gets this far — it renders its own demo
  // state — so this is the backstop, not the user-facing path.
  // In a normal client build IS_DEMO is a compile-time `false` and the
  // bundler drops the branch.
  if (IS_DEMO) {
    throw new SpeakerInviteError({
      code: 'demo',
      status: 0,
      message: 'Invitations are disabled in this demo.',
    });
  }
  const attestation = await appCheckHeaders();
  let response;
  try {
    response = await fetch(`${functionsOrigin()}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...attestation,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SpeakerInviteError({
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
    throw new SpeakerInviteError({
      code: typeof error.code === 'string' ? error.code : 'unknown',
      status: response.status,
      // Verbatim: these messages are the actionable part (which account is
      // linked, whether to wait and retry), and rewriting them client-side
      // would throw that away.
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Something went wrong. Try again.',
      invitedEmailMasked:
        typeof error.invitedEmailMasked === 'string' ? error.invitedEmailMasked : null,
    });
  }
  return payload ?? {};
}

/** @param {string} token @returns {Promise<object>} the server's answer */
export function validateSpeakerInvite(token) {
  return post('validateSpeakerInvite', { token });
}

/**
 * @param {{ token: string, idToken: string }} args
 * @returns {Promise<{ speakerId: string, speakerName: string, emailMismatch: boolean }>}
 */
export function acceptSpeakerInvite({ token, idToken }) {
  return post('acceptSpeakerInvite', { token }, { idToken });
}
