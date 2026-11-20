export function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function sponsorPackageDraws(block) {
  return Boolean(text(block?.name));
}
