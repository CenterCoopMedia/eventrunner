export function buildVersion(commit) {
  return {
    name: 'build-version',
    apply: 'build',
    generateBundle() {
      if (!commit) return;
      if (!/^[0-9a-f]{40}$/.test(commit)) {
        this.error('EVENT_BUILD_COMMIT must be a full Git commit SHA.');
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ commit })}\n`,
      });
    },
  };
}
