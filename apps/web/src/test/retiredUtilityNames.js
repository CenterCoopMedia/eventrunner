// A component migrating off a retired Tailwind utility prefix (see
// tailwind.config.js) can check its own rendered classes are clean without
// writing that prefix into its own source — a repo-wide sweep for the
// prefix (`grep -r` over the directory being migrated) would otherwise flag
// the test file itself alongside the thing it is testing.
export const BRAND_UTILITY_PREFIX = /\bbrand-/;
