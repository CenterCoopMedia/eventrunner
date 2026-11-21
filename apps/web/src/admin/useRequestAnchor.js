import { useEffect, useRef } from 'react';
import { scrollToElement } from '../lib/scrollToTop.js';

/** Land at the start of the requested inbox row when it arrives. */
export function useRequestAnchor(id, rows) {
  const focused = useRef(null);
  useEffect(() => {
    if (!rows || !id || focused.current === id) return;
    const row = document.getElementById(`request-${id}`);
    if (row) {
      focused.current = id;
      scrollToElement(row);
      row.focus({ preventScroll: true });
    }
  }, [id, rows]);
}
