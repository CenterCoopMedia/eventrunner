/** Strip one complete, case-sensitive mount. The bare mount is the app home. */
export function stripEventMount(pathname, mount) {
  if (pathname === mount) return '/';
  return pathname.startsWith(`${mount}/`) ? pathname.slice(mount.length) : null;
}

/** Join a validated asset base and an app-relative pathname. */
export function joinEventPath(assetBase, pathname) {
  return `${assetBase}${pathname.slice(1)}`;
}
