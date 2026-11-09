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

/** Unregister every tool a record registered, after its registration settles. */
async function unregisterAll(modelContext, record) {
  await record.registrationTask;
  await Promise.allSettled(
    record.registrations.map(({ name, registration }) =>
      unregister(modelContext, name, registration),
    ),
  );
}

/**
 * Register one named set once per model-context instance. Concurrent mounts
 * of the same tool list share it, and every execute callback reads the
 * newest state ref. A mount that brings a different list replaces the set:
 * the old tools are unregistered first, then the new ones are registered.
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

  const key = definitions.map((definition) => definition.name).join('\n');
  let record = sets.get(setId);
  if (record && record.key === key) {
    record.mounts += 1;
    record.stateRef = stateRef;
  } else {
    // An effect that re-runs with a new tool list cleans up and mounts again
    // in one commit, exactly as a Strict Mode remount does. Reusing the old
    // record there would keep the old list registered, so retire it instead.
    const previous = record;
    if (previous) previous.retired = true;
    record = {
      key,
      mounts: 1,
      stateRef,
      registrations: [],
      registrationTask: null,
      retired: false,
    };
    const current = record;
    current.registrationTask = (async () => {
      if (previous) await unregisterAll(modelContext, previous);
      await Promise.allSettled(
        definitions.map(async (definition) => {
          const registration = await modelContext.registerTool({
            ...definition,
            execute: async (input) => definition.execute(input, current.stateRef.current),
          });
          current.registrations.push({ name: definition.name, registration });
        }),
      );
    })();
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
      // A retired record's tools are unregistered by the record that replaced it.
      if (record.mounts > 0 || record.retired) return;
      try {
        await record.registrationTask;
        if (record.mounts > 0 || record.retired) return;
        await unregisterAll(modelContext, record);
      } finally {
        if (record.mounts === 0 && sets.get(setId) === record) sets.delete(setId);
        if (sets.size === 0) mountedSets.delete(modelContext);
      }
    });
  };
}
