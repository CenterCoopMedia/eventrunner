// A polite live region for lines that happen inside a control. A control's
// own text is its name, and a changed name is not announced, so a busy
// control that turns late says so here, once.
//
// The region lives in the open modal dialog that holds the control, because
// a modal makes everything outside it inert; otherwise it lives on the body.
// Mount it when the work starts (prepareAnnouncer), so assistive technology
// has registered the empty region before its first line arrives.
const regions = new WeakMap();

export function prepareAnnouncer(node) {
  const host = node?.closest?.('dialog[open]') ?? document.body;
  let region = regions.get(host);
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.dataset.announcer = '';
  region.className = 'sr-only';
  host.append(region);
  regions.set(host, region);
  return region;
}

/** Says `text` in the region for `node`, and returns a way to take it back. */
export function announce(node, text) {
  const region = prepareAnnouncer(node);
  region.textContent = text;
  return () => {
    if (region.textContent === text) region.textContent = '';
  };
}
