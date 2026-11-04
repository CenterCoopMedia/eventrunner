// Leave the console for a provider's page. On its own, so tests can stand in for it.
export function leavePage(url) {
  window.location.assign(url);
}
