// Injected browser-host double. This is test code, not native WebMCP proof.
// Keep this function self-contained: Playwright serializes it for addInitScript.
export function installWebMcpHarness({ supported = true } = {}) {
  const tools = new Map();
  const registrations = [];
  const removals = [];
  const failures = [];
  const modelContext = {
    registerTool(definition) {
      if (tools.has(definition.name)) {
        failures.push(`Duplicate tool: ${definition.name}`);
        throw new Error(`Duplicate tool: ${definition.name}`);
      }
      tools.set(definition.name, definition);
      registrations.push(definition.name);
    },
    unregisterTool(name) {
      tools.delete(name);
      removals.push(name);
    },
  };

  Object.defineProperty(globalThis.document, 'modelContext', {
    configurable: true,
    value: supported ? modelContext : undefined,
  });
  // Mask the older preview surface as well in the unsupported-browser case.
  Object.defineProperty(globalThis.navigator, 'modelContext', {
    configurable: true,
    value: undefined,
  });
  globalThis.__eventrunnerWebMcpTest = {
    evidence: 'injected-test-double',
    documentId: globalThis.crypto.randomUUID(),
    names: () => [...tools.keys()].sort(),
    descriptors: () => [...tools.values()].map(({ name, inputSchema, annotations }) => ({
      name, inputSchema, annotations,
    })),
    registrations,
    removals,
    failures,
    async invoke(name, input = {}) {
      if (!tools.has(name)) throw new Error(`Tool is not registered: ${name}`);
      // Do not validate inputs or redact results here. Those are application
      // and native-host responsibilities, not behavior a double can prove.
      return tools.get(name).execute(input);
    },
  };
}
