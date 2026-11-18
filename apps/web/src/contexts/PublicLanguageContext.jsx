import { createContext, lazy, Suspense, useContext, useState } from 'react';
import { useHref, useLocation, useNavigate } from 'react-router';
import { useContent } from './ContentContext.jsx';
import { useEventConfig } from './EventConfigContext.jsx';

const PublicLanguageRuntime = lazy(() => import('./PublicLanguageRuntime.jsx'));
export const englishLanguage = {
  language: 'en', available: ['en'], urlLanguage: null, localize: (href) => href,
  text: (value) => value,
};
const LanguageContext = createContext(englishLanguage);
const adminRoute = /^\/admin(?:[/?#]|$)/i;

export const isAdminRoute = (path) => adminRoute.test(path);

// The loader only checks whether it might need the resolver. The runtime
// validates the complete event setting before it selects an available locale.
export function mayHaveSpanish(eventConfig) {
  const available = eventConfig?.contentLanguages?.available;
  return Array.isArray(available) && available.includes('es');
}

export function PublicLanguageProvider({ children }) {
  const { eventConfig } = useEventConfig();
  const { pathname, search } = useLocation();
  const rootHref = useHref('/');
  const navigate = useNavigate();
  const [published, setPublished] = useState(null);
  const isAdmin = isAdminRoute(pathname);
  const needsRuntime = published !== null || (!isAdmin
    && (mayHaveSpanish(eventConfig) || new URLSearchParams(search).has('lang')));
  const value = isAdmin ? englishLanguage : { ...(published ?? englishLanguage), rootHref, navigate };
  return (
    <LanguageContext.Provider value={value}>
      {children}
      {needsRuntime ? (
        <Suspense fallback={null}><PublicLanguageRuntime onChange={setPublished} /></Suspense>
      ) : null}
    </LanguageContext.Provider>
  );
}

export function usePublicLanguage() {
  return useContext(LanguageContext);
}

// Admin keeps the original getters. A new live record replaces any
// projection of its predecessor while the reader projects the new source.
export function usePublicContent() {
  const content = useContent();
  const { sourceContent, localizedContent } = usePublicLanguage();
  return sourceContent === content ? localizedContent : content;
}
