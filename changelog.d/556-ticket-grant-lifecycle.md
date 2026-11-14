### Added

- Ticket claims and ticket changes now derive private combined resource grants
  from the current valid claimed set. Operator policy revisions can recompute
  those grants with resumable progress. Current full-event access stays in place
  until the separate enforcement and migration work is complete.
