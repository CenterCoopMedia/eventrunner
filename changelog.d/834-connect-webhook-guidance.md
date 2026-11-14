### Fixed

- Manual ticket-webhook verification directs Stripe Connect operators to Console provisioning when Stripe refuses OAuth webhook management. Failed verification keeps its failure status and writes no readiness stamp; direct-account verification remains available (#834).
