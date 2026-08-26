// Static demo build flag (VITE_DEMO_MODE=1).
//
// The public showcase build (scripts/build-demo.cjs → docs/demo/) is a
// read-only clone of this app served from GitHub Pages with NO Firebase
// project behind it. Everything it shows comes from the committed synthetic
// snapshot in src/generated (spec §2.4 first paint); the runtime overlay,
// auth, and every write path are inert.
//
// This flag is the single switch for that. It is read only through
// `import.meta.env`, so a normal client build — which never sets
// VITE_DEMO_MODE — compiles it to `false` and the bundler drops every demo
// branch. The per-client pipeline (deploy-client.yml, scripts/publish-site.cjs)
// is therefore byte-for-byte unaffected.
export const IS_DEMO =
  import.meta.env.VITE_DEMO_MODE === '1' ||
  import.meta.env.VITE_DEMO_MODE === 'true';

export default IS_DEMO;
