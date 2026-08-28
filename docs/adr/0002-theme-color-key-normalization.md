# ADR 0002: Normalize theme color keys at read boundaries

## Status

Accepted.

## Context

The seed scripts and the admin editor historically wrote the same `config/theme.colors` roles with two spellings. Seeded documents use names such as `brandPrimary` and `brandInk`. The admin editor uses `primary` and `ink`. The shared theme module already defines `canonicalColorKey` so consumers can read both forms.

The public theme runtime followed that rule, but the schedule PDF and Branding form seed path read only the admin spelling. A seeded deployment could therefore show its configured palette on the site while a PDF used fallbacks or the editor appeared to start from another value.

## Decision

Every consumer of stored `config/theme.colors` must canonicalize a role at the read boundary.

- Canonical role names are the current write shape.
- Legacy seed aliases remain valid input.
- When a document contains both spellings, the canonical key wins.
- Consumers use `canonicalColorKey` from the shared theme module. They do not copy the alias table.
- Unknown roles remain validation errors at write time and are ignored by bounded readers.

## Consequences

Existing seeded deployments keep their palette in generated PDFs and in the Branding editor. A later admin save writes the canonical shape and completes the migration without a separate data rewrite.

New stored-color consumers need tests for a seeded document and for a transitional document that contains both spellings.

## Non-goals

This decision does not change the Firestore schema, rewrite stored documents, alter palette derivation, or relax color-value validation.
