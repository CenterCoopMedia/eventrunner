import { internalRoutePath } from 'shared/languageUrls';
import { safeUrlHref } from 'shared/urlSafety';
import { isMediaLibraryPath, storageObjectPath } from 'shared/venue';

const CONTROL_CHARACTER = /\p{Cc}/u;

export function timelineHref(value) {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (CONTROL_CHARACTER.test(href) || href.includes('\\')) return null;
  if (internalRoutePath(href)) return href;
  const absolute = safeUrlHref(href);
  return absolute.startsWith('https://') && !/^https:\/\/[^/?#]*@/.test(absolute) ? absolute : null;
}

export function timelineImagePath(value) {
  const path = storageObjectPath(value);
  return isMediaLibraryPath(path) && !CONTROL_CHARACTER.test(path) && !path.includes('\\') ? path : null;
}
