### Fixed

- Keep sampled performance observations in the existing bounded memory queue while event
  configuration is unconfirmed. Send them only after confirmed opt-in and discard them on
  confirmed opt-out, so a temporary cached answer no longer loses a metric's first report (#908).
