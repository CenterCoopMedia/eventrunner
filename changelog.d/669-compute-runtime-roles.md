### Security

- New client projects no longer keep the Editor role that Google gives the compute runtime account. The provisioner removes it after it grants the explicit runtime roles, and `scripts/compute-editor-plan.cjs` prints a read-only plan for existing projects (#669).

### Fixed

- The functions runtime uses `roles/run.jobsExecutorWithOverrides` on the site publisher job to pass its queue ID without relying on the Editor role (#669).
