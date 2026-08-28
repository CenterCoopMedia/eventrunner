// WebMCP registration lifecycle shared by the public and admin tool sets.
// The module has no side effect until mountToolSet is called.

const mountedSets = new WeakMap();

/**
 * Use the current documented surface first. The navigator fallback keeps
 * compatibility with earlier browser previews that exposed the same API
 * there.
 */
export function resolveModelContext(browser = globalThis) {
  const candidates = [browser?.document?.modelContext, browser?.navigator?.modelContext];
  return candidates.find((candidate) =>
    typeof candidate?.registerTool === 'function',
  ) ?? null;
}

async function unregister(modelContext, name, registration) {
  if (typeof registration?.unregister === 'function') {
    await registration.unregister();
    return;
  }
  if (typeof modelContext.unregisterTool === 'function') {
    await modelContext.unregisterTool(name);
  }
}

/**
 * Register one named set once per model-context instance. Concurrent mounts
 * share it, and every execute callback reads the newest state ref.
 */
export function mountToolSet({ modelContext, setId, definitions, stateRef }) {
  if (!modelContext || typeof modelContext.registerTool !== 'function') {
    return () => {};
  }

  let sets = mountedSets.get(modelContext);
  if (!sets) {
    sets = new Map();
    mountedSets.set(modelContext, sets);
  }

  let record = sets.get(setId);
  if (record) {
    record.mounts += 1;
    record.stateRef = stateRef;
  } else {
    record = {
      mounts: 1,
      stateRef,
      registrations: [],
      registrationTask: null,
    };
    record.registrationTask = Promise.allSettled(
      definitions.map(async (definition) => {
        const registration = await modelContext.registerTool({
          ...definition,
          execute: async (input) => definition.execute(input, record.stateRef.current),
        });
        record.registrations.push({ name: definition.name, registration });
      }),
    );
    sets.set(setId, record);
  }

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    record.mounts -= 1;

    // React Strict Mode remounts effects immediately. Wait one microtask so
    // that remount can reuse the pending registrations instead of creating
    // a duplicate set.
    queueMicrotask(async () => {
      if (record.mounts > 0) return;
      try {
        await record.registrationTask;
        if (record.mounts > 0) return;
        await Promise.all(
          record.registrations.map(({ name, registration }) =>
            unregister(modelContext, name, registration),
          ),
        );
      } finally {
        if (record.mounts === 0) sets.delete(setId);
        if (sets.size === 0) mountedSets.delete(modelContext);
      }
    });
  };
}
