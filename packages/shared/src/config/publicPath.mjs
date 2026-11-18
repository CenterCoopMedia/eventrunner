/** Strip one complete, case-sensitive mount. The bare mount is the app home. */
export function stripEventMount(pathname, mount) {
  if (pathname === mount) return '/';
  return pathname.startsWith(`${mount}/`) ? pathname.slice(mount.length) : null;
}

/** Join a validated public or asset base and an app-relative path. */
export function joinEventPath(base, path) {
  return `${base}${path.slice(1)}`;
}
