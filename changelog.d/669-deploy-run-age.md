### Fixed

- Keep site builds from reusing a deployment that predates the request or has no valid creation time. Preserve completed runs from the same request and apply ticket-change bounds at the provider's timestamp precision (#669).
