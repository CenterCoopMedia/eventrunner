# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public repository under the Center for Cooperative Media, Apache-2.0.
- Shared workspace package: deploy-env validation, event config schema, lifecycle clock, event-timezone time helpers, registration state machine, badge validation, slug and URL-safety utilities.
- Day-one legal and community files: LICENSE, NOTICE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, issue and pull request templates.
- Credential-free CI for the shared-package test suite.
- Product site on GitHub Pages.
- Three-workspace layout: `apps/web` and `functions` join `packages/shared` as npm workspaces (spec §1.1–1.2).
- ESLint flat config with the hex-literal ban and its three-path allowlist (spec §7.6) plus `react-hooks/rules-of-hooks`.
- Firestore and Storage security-rules tests running on the Firebase emulators, and CI lint + rules jobs — still credential-free and fork-runnable (spec §8.1).

The feature set itself is specified in [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md). Web app, Cloud Functions, and the remaining Phase 2 modules have not landed yet.
