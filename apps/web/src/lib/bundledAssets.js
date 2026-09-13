/** Demo images ship with every build and never need a Storage request. */
export function bundledDemoAssetUrl(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!/^(?:demo\/(?:speakers\/|sponsors\/)?[a-z0-9-]+\.webp|branding\/demo-venue-plan\.svg)$/.test(path)) {
    return null;
  }
  return `${import.meta.env.BASE_URL}${path}`;
}
