// SectionEditLink — the one way from a public page into its editor (issue
// #198). A signed-in admin sees "Edit section" beside each section a page
// draws, and it opens that section's blocks in the admin.
//
// It is a convenience, not a permission. It reads the admin probe's answer
// (AuthContext `adminStatus`) and nothing else; AdminGate, the tier check in
// the admin shell, requireAdmin on the server and firestore.rules decide
// every read and write, exactly as they do for a typed /admin URL.
//
// It stays out of the admin bundle on purpose: it imports nothing under
// src/admin (scripts/ci/bundle-budget.test.cjs holds that), so the public
// first paint carries this one link and never an editor. One link per drawn
// section, never one per block or per field.
//
// It reads the context directly rather than through useAuth(), so a render
// with no auth provider (a component test, a specimen) is "not an admin" and
// draws nothing instead of throwing.
import { useContext } from 'react';
import { Link } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';
import { textControlStateClass } from './controlClasses.js';

/**
 * The admin path for one section's blocks. Page ids are URL-safe, but a
 * section id only has to be non-empty and unique on its page, so both are
 * encoded.
 *
 * @param {string} pageId
 * @param {string} sectionId
 * @returns {string}
 */
export function sectionEditPath(pageId, sectionId) {
  return `/admin/content/${encodeURIComponent(pageId)}/${encodeURIComponent(sectionId)}`;
}

/**
 * @param {{ pageId?: string, sectionId: string, label?: string, className?: string }} props
 */
export default function SectionEditLink({ pageId, sectionId, label, className = '' }) {
  const auth = useContext(AuthContext);
  if (auth?.adminStatus !== 'admin' || !pageId || !sectionId) return null;
  return (
    <Link
      to={sectionEditPath(pageId, sectionId)}
      // The visible words stay short; the name says which section, and it
      // starts with the visible words so a voice command still finds it.
      aria-label={`Edit section: ${label || sectionId}`}
      className={`${textControlStateClass} touch-target inline-flex items-center font-data text-caption font-medium text-text-primary underline underline-offset-4 no-print ${className}`}
    >
      Edit section
    </Link>
  );
}
