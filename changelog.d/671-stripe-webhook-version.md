### Fixed

- Pin provisioned Stripe test webhook payloads to the receiving SDK's API version. Build retries replace endpoints with an unset or different version and reuse matching endpoints (#671).
