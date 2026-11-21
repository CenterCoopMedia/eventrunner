### Added

- Operators can look up one system error by the `errorId` in its alert. `getSystemError` returns only the kind, the page's route shape, the browser family, first and last seen times and whether the record is open, never the reporter's text, full URL or user agent (#1378).
