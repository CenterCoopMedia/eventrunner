import { useEffect, useRef } from 'react';

/** The inbox rows arrive after the link opens. Focus the requested row once. */
export function useRequestAnchor(id, rows) {
  const focused = useRef(null);
  useEffect(() => {
    if (!rows || !id || focused.current === id) return;
    const row = document.getElementById(`request-${id}`);
    if (row) {
      focused.current = id;
      row.focus();
    }
  }, [id, rows]);
}
