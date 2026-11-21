// Draw a piece of admin UI in the site's public theme (issue #1153).
//
// The admin never adopts the site's theme; previews of public content opt in
// one element at a time. Each element gets the theme document the public
// page itself applies (EventConfigContext `publicTheme`), and the theme is
// applied again when the system colour mode changes, as the public page does.
//
// applyThemePreview keeps ONE style element per document, so every call
// replaces the last. Elements therefore register here and are applied
// together: the block picker and each section preview on one screen all keep
// their theme.
import { useEffect, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { applyThemePreview, releaseThemePreviewTarget } from './themePreview.js';

const scopes = new Map();
let appliedTheme = null;

function applyAll() {
  if (!appliedTheme || scopes.size === 0) return;
  applyThemePreview(appliedTheme, { scopes: [...scopes.entries()].map(([element, id]) => ({ element, id })) });
}

function prefersDarkNow() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/**
 * @param {HTMLElement|null} element the element to theme; the root element
 *   of a preview document themes that whole document
 * @param {string} scopeId a document-unique id for that element
 */
export function usePublicThemeScope(element, scopeId) {
  const { publicTheme } = useEventConfig();
  const [systemDark, setSystemDark] = useState(prefersDarkNow);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!publicTheme || !element) return undefined;
    appliedTheme = publicTheme;
    scopes.set(element, scopeId);
    applyAll();
    return () => {
      scopes.delete(element);
      releaseThemePreviewTarget(element);
      applyAll();
    };
  }, [publicTheme, systemDark, element, scopeId]);
}
