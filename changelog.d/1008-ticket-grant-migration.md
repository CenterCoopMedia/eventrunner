### Added

- Operators can take a read-only inventory of ticket classes, approval sources
  and ticket resource grants for one client project, backfill grants with a dry
  run first, publish a ticket resource policy after its checks pass, and roll
  back to full-event access. The runbook is
  `docs/operator/ticket-resource-grants.md`. No deployment changes mode until
  an operator publishes a policy.
