// A full page reload. A module of its own so tests can replace the
// navigation, which jsdom does not implement.
export function reloadPage() {
  globalThis.location.reload();
}
