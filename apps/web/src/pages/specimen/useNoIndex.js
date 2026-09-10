// Keep the specimen book out of a search index.
//
// The routes in this app carry their metadata by writing the document
// directly (lib/useDocumentTitle.js): there is no head manager, and the
// server writes the title and the social tags for the routes it knows
// about. This is the same shape for the one tag this page needs. The tag
// exists only while the page is mounted, so a reader who leaves the book
// for the home page is on an indexable page again.
//
// The element is found by name rather than kept in a ref, so a second mount
// in the same document does not leave two tags behind.
import { useEffect } from 'react';

export const ROBOTS_SELECTOR = 'meta[name="robots"][data-specimen="true"]';

/** Add the tag. Returns the element, or null with no document. */
export function addNoIndexTag(doc = typeof document === 'undefined' ? null : document) {
  if (!doc || !doc.head) return null;
  const existing = doc.querySelector(ROBOTS_SELECTOR);
  if (existing) return existing;
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'robots');
  meta.setAttribute('content', 'noindex');
  meta.setAttribute('data-specimen', 'true');
  doc.head.appendChild(meta);
  return meta;
}

/** Remove the tag, if this module added one. */
export function removeNoIndexTag(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return;
  const existing = doc.querySelector(ROBOTS_SELECTOR);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}

/** Mark the current page as one a crawler must not index. */
export default function useNoIndex() {
  useEffect(() => {
    addNoIndexTag();
    return removeNoIndexTag;
  }, []);
}
