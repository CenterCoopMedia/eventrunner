// Rolldown can emit a dead dynamic import when its gate is in another
// module. Check the emitted code too: Client builds must not ship review UI.
export function specimenBoundary() {
  let demo = false;
  return {
    name: 'client-specimen-boundary',
    apply: 'build',
    configResolved(config) {
      demo = config.env.VITE_DEMO_MODE === '1' || config.env.VITE_DEMO_MODE === 'true';
    },
    generateBundle(_options, bundle) {
      if (demo) return;
      const leaked = Object.values(bundle).filter((item) => item.type === 'chunk'
        && (item.code.includes('data-specimen-file') || item.code.includes('data-admin-specimen')));
      if (leaked.length) this.error(`Client build contains specimen UI: ${leaked.map((item) => item.fileName).join(', ')}`);
    },
  };
}
