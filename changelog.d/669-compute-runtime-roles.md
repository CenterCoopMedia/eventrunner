### Security

- New client projects no longer keep the Editor role that Google gives the compute runtime account. The provisioner removes it after it grants the explicit runtime roles, and `scripts/compute-editor-plan.cjs` prints a read-only plan for existing projects (#669).

### Fixed

- The site publisher job grants the functions runtime `roles/run.jobsExecutorWithOverrides`, which a publish needs to pass its queue id. `roles/run.invoker` does not allow that call; it worked only through the Editor role (#669).
