export function isNetworkOnlyPath(pathname) {
  return /^\/(?:admin|ticket|tickets|profile|speaker|attendees|schedule\/(?:mine|user)|pitch|registration|signin|unsubscribe|dashboard|low-bandwidth|specimen)(?:\/|$)/i
    .test(pathname);
}

export function needsNetworkDocument(pathname, search) {
  return new URLSearchParams(search).has('preview')
    || (isNetworkOnlyPath(pathname) && !/^\/schedule\/mine\/?$/i.test(pathname));
}
