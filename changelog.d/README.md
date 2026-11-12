# Changelog fragments

Add one Markdown file for each behavior PR, named `<issue>-<short-slug>.md`, such as
`865-changelog-fragments.md`. Pure refactors and test-only changes need no fragment.

Use the relevant headings from `Added`, `Changed`, `Fixed`, `Removed` and `Security`, followed
by bullet entries. Describe what changed and why it matters to someone reading the release
notes, and include the issue or PR number. Leave release versions and dates out.

```markdown
### Fixed

- Keep the admin navigation available when a page fails to render (#663).
```

Behavior PRs edit their own fragment. The [release PR](../RELEASING.md#cutting-a-tag) groups all
fragment entries with the current Unreleased notes in `CHANGELOG.md`, then deletes the
collected fragment files in the same PR. Keep this README. Review the release diff to confirm
that every deleted fragment entry appears in the version section.
