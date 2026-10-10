// In-app leave guard for a dirty editor (issue #446).
//
// The app uses BrowserRouter and HashRouter, not a data router, so
// useBlocker is unavailable. Reload and tab close use beforeunload. A
// same-document link is caught on click, before the router moves. Browser
// Back/Forward has already changed the URL when popstate runs, so the
// capture listener stops the router and steps forward again. The operator
// then chooses Stay or Discard.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Path the router should move to, or null when this click should not be
 * intercepted (external, new tab, or the page the operator is already on).
 *
 * @param {string} href
 * @param {string} currentHref
 * @returns {string|null}
 */
export function inAppPath(href, currentHref) {
  let url;
  let current;
  try {
    url = new URL(href, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  const nextHash = url.hash.startsWith('#/') ? url.hash.slice(1) : '';
  const currentHash = current.hash.startsWith('#/') ? current.hash.slice(1) : '';
  if (nextHash || currentHash) {
    if (!nextHash) return null;
    if (nextHash === currentHash && url.search === current.search) return null;
    return `${nextHash}${url.search}`;
  }
  const next = `${url.pathname}${url.search}`;
  const here = `${current.pathname}${current.search}`;
  if (next === here) return null;
  return next;
}

/**
 * @param {boolean} unsaved
 * @returns {{ pending: boolean, stay: () => void, discard: () => void }}
 */
export function useUnsavedNavigation(unsaved) {
  const navigate = useNavigate();
  const unsavedRef = useRef(unsaved);
  const allowLeaveRef = useRef(false);
  const ignorePopRef = useRef(false);
  const pendingRef = useRef(null);
  const [pending, setPending] = useState(null);

  unsavedRef.current = unsaved;
  pendingRef.current = pending;

  useEffect(() => {
    if (!unsaved) return undefined;
    const onBeforeUnload = (event) => {
      if (allowLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  useEffect(() => {
    if (!unsaved) return undefined;
    const onClick = (event) => {
      if (allowLeaveRef.current || pendingRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const path = inAppPath(anchor.href, window.location.href);
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ kind: 'push', to: path });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [unsaved]);

  useEffect(() => {
    const onPopState = (event) => {
      if (ignorePopRef.current) {
        ignorePopRef.current = false;
        event.stopImmediatePropagation();
        return;
      }
      if (!unsavedRef.current || allowLeaveRef.current) return;
      event.stopImmediatePropagation();
      ignorePopRef.current = true;
      window.history.go(1);
      setPending({ kind: 'back' });
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, []);

  function stay() {
    setPending(null);
  }

  function discard() {
    const next = pendingRef.current;
    allowLeaveRef.current = true;
    setPending(null);
    if (!next) return;
    if (next.kind === 'push') navigate(next.to);
    if (next.kind === 'back') window.history.back();
  }

  return { pending: pending !== null, stay, discard };
}
