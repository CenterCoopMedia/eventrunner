/** In-app admin path the sign-in page may return to. Every other value is refused. */
export function adminReturnPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0 || path.length > 512) return null;
  if (!/^\/admin(?:\/[^?#]*)?(?:\?[^#]*)?$/.test(path)) return null;
  if (path.includes('\\') || path.includes('//') || path.split('/').includes('..')) return null;
  return path;
}
