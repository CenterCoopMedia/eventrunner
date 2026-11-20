### Fixed

- A missing page file sends no operator alert when the automatic reload
  recovers the page. If the file still fails to load after the reload, the
  alert identifies the page file and the builds before and after it (#1144).
