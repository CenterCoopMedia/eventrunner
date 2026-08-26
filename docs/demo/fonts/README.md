# Bundled font sets

Self-hosted woff2 files for the bundled font-set allowlist (spec §7.4) —
no font CDN request at runtime. Latin subsets of variable fonts
(weight range 400–700):

| File | Family | Set id | License |
| --- | --- | --- | --- |
| `source-serif-4-latin.woff2` | Source Serif 4 | `serif-editorial` | SIL OFL 1.1 |
| `source-sans-3-latin.woff2` | Source Sans 3 | `sans-humanist` | SIL OFL 1.1 |
| `caveat-latin.woff2` | Caveat | `script-casual` | SIL OFL 1.1 |

All three are licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>). Adding a font set is a deliberate,
reviewable PR: add the woff2 here, the `@font-face` + stack emission in
`scripts/generate-content.cjs`, and the set id to the allowlist.
