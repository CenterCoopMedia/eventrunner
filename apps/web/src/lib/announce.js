// One polite live region for lines that happen inside a control. A control's
// own text is its name, and a changed name is not announced, so a busy
// control that turns late says so here, once.
let region = null;

function liveRegion() {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.dataset.announcer = '';
  region.className = 'sr-only';
  document.body.append(region);
  return region;
}

export function announce(text) {
  liveRegion().textContent = text;
}

/** Clears the region only when it still holds `text`, so a newer line stays. */
export function withdraw(text) {
  if (region?.isConnected && region.textContent === text) region.textContent = '';
}
