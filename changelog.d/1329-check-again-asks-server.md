### Fixed

- "Check again" on "We could not check your admin access" now asks the server
  at once. After a blocked request, the access check kept answering from the
  cache until Firestore's own reconnect delay ran out, up to 90 seconds (#1329).
