# Governance

Run of Show is a public Apache-2.0 project operated by the Center for Cooperative Media at Montclair State University.

## Who decides

- **Product and license:** CCM. The working name and mark stay with CCM even though the code is Apache-2.0.
- **Operator:** the person running deployments and GitHub admin (currently Joe Amditis). Releases, branch protection, and environment secrets live here so they do not depend on a third-party account.
- **Architecture:** the [v1 spec](docs/adr/0001-event-platform-v1.md) and [triage record](docs/plans/2026-08-16-event-platform-v1-triage.md) are the contract. Changes to those decisions land as a new ADR, not a drive-by PR.

## What belongs where

| Situation | Where it goes |
|---|---|
| Something in the shared code is wrong | [Issue](https://github.com/CenterCoopMedia/run-of-show/issues/new/choose) using the bug form |
| A change to the platform | Issue using the feature form, then a PR linked to it |
| "How do I…?" on a live event site | [Discussions](https://github.com/CenterCoopMedia/run-of-show/discussions) (Q&A) |
| "We want CCM to run our event" | Discussions (General) or email info@collaborativejournalism.org |
| A hosted site CCM operates for you is broken | Email info@collaborativejournalism.org — not a public issue |
| A security problem in this repo | [Private vulnerability reporting](https://github.com/CenterCoopMedia/run-of-show/security) |

## Review

- One logical change per pull request.
- Every commit is signed off under the [Developer Certificate of Origin](https://developercertificate.org/).
- CI must stay green on the PR, including from forks, with no secrets.
- Maintainers may request changes, close out-of-scope work, or move a conversation to Discussions.

## Releases

Tagged releases follow Keep a Changelog in [CHANGELOG.md](CHANGELOG.md). Only the latest tag is a supported security line. See [SECURITY.md](SECURITY.md).
