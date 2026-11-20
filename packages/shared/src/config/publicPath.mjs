/** Strip one complete, case-sensitive mount. The bare mount is the app home. */
export function stripEventMount(pathname, mount) {
  if (pathname === mount) return '/';
  return pathname.startsWith(`${mount}/`) ? pathname.slice(mount.length) : null;
}

/**
 * Join a base that ends in `/` (a validated asset base or an absolute public
 * base) and an app-relative path that starts with `/`. The path may include a
 * query string.
 */
export function joinEventPath(base, appPath) {
  return `${base}${appPath.slice(1)}`;
}
