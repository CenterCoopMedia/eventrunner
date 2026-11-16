### Fixed

- Stop older client and console deploy runs before production writes when a newer revision is already live, including deploys whose later checks failed. Preserve same-revision retries and forward deploys. Intentional rollbacks require `allow_older_sha` and a `rollback_reason` recorded in the run summary; unavailable deployment history or ancestry stops the run (#1026).
