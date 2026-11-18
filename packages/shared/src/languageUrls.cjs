'use strict';

const { isSafeRichTextHref } = require('./richText.cjs');
const { isCanonicalPagePath } = require('./routing.cjs');

const LANGUAGES = Object.freeze(['en', 'es']);

function languageFromSearch(search, available = LANGUAGES) {
  const values = new URLSearchParams(search).getAll('lang');
  return values.length === 1 && available.includes(values[0]) ? values[0] : null;
}

function localPath(href) {
  return isSafeRichTextHref(href) && href.startsWith('/') && !href.startsWith('//');
}

function internalRoutePath(href) {
  if (!localPath(href)) return null;
  const pathname = href.split(/[?#]/, 1)[0];
  const canonical = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return isCanonicalPagePath(canonical) ? canonical : null;
}

function withContentLanguage(href, language) {
  if (!LANGUAGES.includes(language) || !localPath(href)) return href;
  const fragmentStart = href.indexOf('#');
  const beforeFragment = fragmentStart === -1 ? href : href.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? '' : href.slice(fragmentStart);
  const queryStart = beforeFragment.indexOf('?');
  const pathname = queryStart === -1 ? beforeFragment : beforeFragment.slice(0, queryStart);
  if (/[\s\\]/.test(pathname)) return href;
  const query = new URLSearchParams(queryStart === -1 ? '' : beforeFragment.slice(queryStart + 1));
  query.set('lang', language);
  return `${pathname}?${query}${fragment}`;
}

module.exports = { LANGUAGES, languageFromSearch, internalRoutePath, withContentLanguage };
