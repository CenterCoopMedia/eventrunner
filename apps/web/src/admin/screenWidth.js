// How wide the admin workspace is for one screen (issue #1153).
//
// The workspace was bounded at 64rem on every screen (#1042), so at 1920px a
// table or the page editor used about half the screen. The bound now belongs
// to the screen type: lists, dashboards and the page and content editors use
// the whole workspace; plain forms and single-record editors keep 64rem.
// Text keeps its 64ch measure on every screen (adminWorkspace.css).

// Sections whose own first screen is a form, not a list.
const FORM_SECTIONS = new Set([
  'setup', 'settings', 'features', 'access', 'web-address',
  'registration-form', 'badges', 'data-export', 'import',
]);
// Sections whose record screens are editors that draw the site beside the
// fields.
const WIDE_EDITOR_SECTIONS = new Set(['pages', 'content']);

/**
 * @param {string} pathname a router pathname under /admin
 * @returns {'wide'|'form'}
 */
export function adminScreenWidth(pathname) {
  const segments = String(pathname ?? '').split('/').filter(Boolean);
  if (segments[0] !== 'admin') return 'form';
  const [, section = '', ...rest] = segments;
  if (FORM_SECTIONS.has(section)) return 'form';
  if (rest.length === 0 || WIDE_EDITOR_SECTIONS.has(section)) return 'wide';
  return 'form';
}
