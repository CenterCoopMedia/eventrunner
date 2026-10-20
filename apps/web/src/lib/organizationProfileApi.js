// A representative's own organization (issue #334): the client seam for
// ownOrganizationProfile (functions/src/cms/organizationRepresentatives.cjs).
//
// Not an admin endpoint, but the same wire shape (POST with a bearer ID
// token, `{ error: { code, message } }` on failure), so it reuses
// callAdminEndpoint, as speakerProfileApi.js does. No call names an
// organization: the server reads it from the caller's grant.
import { callAdminEndpoint } from '../admin/adminApi.js';

function idTokenGetter(user) {
  return () => {
    if (!user || typeof user.getIdToken !== 'function') {
      return Promise.reject(new Error('not signed in'));
    }
    return user.getIdToken();
  };
}

/**
 * The caller's organization: its id, its live public profile (null when
 * it is not on the site yet), and the caller's edit waiting for review.
 *
 * @param {{ user: object }} args
 * @returns {Promise<{ organizationId: string, organization: object|null, pending: object|null }>}
 */
export function getOwnOrganization({ user }) {
  return callAdminEndpoint('ownOrganizationProfile', { action: 'get' }, idTokenGetter(user));
}

/**
 * Send an edit of the description, the biography and the website for
 * review. The server refuses any other field by name.
 *
 * @param {{ user: object, fields: { description?: string|null, bio?: string|null, url?: string|null } }} args
 * @returns {Promise<{ organizationId: string, pending: object|null }>}
 */
export function submitOrganizationEdit({ user, fields }) {
  return callAdminEndpoint('ownOrganizationProfile', { action: 'submit', fields }, idTokenGetter(user));
}
