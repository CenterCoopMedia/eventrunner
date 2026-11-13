/** The three render shapes used by the header and public Program. */
export function snapshotViewport(view) {
  if (view.matchMedia('(max-width: 639px)').matches) return 'compact';
  if (view.matchMedia('(min-width: 64rem)').matches) return 'wide';
  return 'standard';
}
