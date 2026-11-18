import { createContext, useContext } from 'react';

export const englishLanguage = {
  language: 'en', available: ['en'], urlLanguage: null, localize: (href) => href,
  text: (value) => value,
};

export const LanguageContext = createContext(englishLanguage);
const adminRoute = /^\/admin(?:[/?#]|$)/i;

export const isAdminRoute = (path) => adminRoute.test(path);

export function usePublicLanguage() {
  return useContext(LanguageContext);
}
