### Fixed

- Pace writes on every client Functions deploy, including function updates, invoker policies and provider retries. Keep unchanged-function detection and retry-policy safeguards, and wait out quota errors before failing the deployment (#954).
