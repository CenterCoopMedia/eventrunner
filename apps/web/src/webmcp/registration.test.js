import { describe, expect, it, vi } from 'vitest';
import { mountToolSet, resolveModelContext } from './registration.js';

const definition = {
  name: 'read_state',
  description: 'Read test state.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: (_input, state) => ({ value: state.value }),
};

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('WebMCP registration lifecycle', () => {
  it('prefers the current document surface and accepts the preview navigator surface', () => {
    const documentContext = { registerTool() {} };
    const navigatorContext = { registerTool() {} };
    expect(resolveModelContext({
      document: { modelContext: documentContext },
      navigator: { modelContext: navigatorContext },
    })).toBe(documentContext);
    expect(resolveModelContext({
      document: {},
      navigator: { modelContext: navigatorContext },
    })).toBe(navigatorContext);
    expect(resolveModelContext({ document: {}, navigator: {} })).toBeNull();
  });

  it('shares duplicate mounts, reads current state, and unregisters after the last cleanup', async () => {
    const unregister = vi.fn();
    let registered;
    const modelContext = {
      registerTool: vi.fn(async (tool) => {
        registered = tool;
        return { unregister };
      }),
    };
    const firstState = { current: { value: 'old' } };
    const secondState = { current: { value: 'current' } };

    const cleanupFirst = mountToolSet({
      modelContext,
      setId: 'test',
      definitions: [definition],
      stateRef: firstState,
    });
    const cleanupSecond = mountToolSet({
      modelContext,
      setId: 'test',
      definitions: [definition],
      stateRef: secondState,
    });
    await settle();

    expect(modelContext.registerTool).toHaveBeenCalledTimes(1);
    expect(await registered.execute({})).toEqual({ value: 'current' });

    cleanupFirst();
    await settle();
    expect(unregister).not.toHaveBeenCalled();

    cleanupSecond();
    await settle();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('turns an unsupported mount into a strict no-op', () => {
    const cleanup = mountToolSet({
      modelContext: null,
      setId: 'test',
      definitions: [definition],
      stateRef: { current: {} },
    });
    expect(cleanup()).toBeUndefined();
  });
});

