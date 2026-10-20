// The representative's form (issue #334): its fields, its limits and its
// own checks. The server repeats each check
// (functions/src/cms/organizations.cjs validateRepresentativeFields), and
// organizationProfileForm.test.js holds the limits to the server's.
import { isSafeUrl } from 'shared/urlSafety';

/** The longest value each field may hold, in characters. */
export const REPRESENTATIVE_LIMITS = Object.freeze({
  description: 500,
  bio: 5000,
  url: 2000,
});

const textOrNull = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

/** The `fields` the server receives: every field, trimmed, blank as null. */
export function representativeFields(form) {
  return {
    description: textOrNull(form.description),
    bio: textOrNull(form.bio),
    url: textOrNull(form.url),
  };
}

/**
 * The form's own checks, field by field.
 *
 * @param {{ description: string, bio: string, url: string }} form
 * @returns {Map<string, string>} field → message
 */
export function validateRepresentativeForm(form) {
  const errors = new Map();
  for (const field of ['description', 'bio']) {
    if (String(form[field] ?? '').trim().length > REPRESENTATIVE_LIMITS[field]) {
      errors.set(field, `Use ${REPRESENTATIVE_LIMITS[field]} characters or fewer.`);
    }
  }
  const url = String(form.url ?? '').trim();
  if (url && !isSafeUrl(url)) errors.set('url', 'Enter a link that starts with http:// or https://.');
  else if (url.length > REPRESENTATIVE_LIMITS.url) errors.set('url', `Use ${REPRESENTATIVE_LIMITS.url} characters or fewer.`);
  return errors;
}
