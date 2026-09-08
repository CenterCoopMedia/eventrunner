'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

async function browser(supported = true) {
  const { installWebMcpHarness } = await import('../e2e/webmcp-harness.mjs');
  const context = vm.createContext({
    document: {},
    navigator: { modelContext: { registerTool() {} } },
    crypto: { randomUUID: () => 'test-document' },
  });
  // Serialization catches accidental imports or closure dependencies that
  // would work in Node but fail inside Playwright's addInitScript.
  vm.runInContext(`(${installWebMcpHarness.toString()})({ supported: ${supported} })`, context);
  return context;
}

test('the injected host forwards application execution without altering output', async () => {
  const context = await browser();
  const calls = [];
  const output = { arbitrary: 'This value must not be redacted by the double.' };
  const schema = { type: 'object', properties: {}, additionalProperties: false };
  context.document.modelContext.registerTool({
    name: 'diagnostic', inputSchema: schema, annotations: { readOnlyHint: true },
    execute(input) { calls.push(input); return output; },
  });
  const input = { extra: 'The double does not pretend to validate a host schema.' };
  assert.equal(await context.__eventrunnerWebMcpTest.invoke('diagnostic', input), output);
  assert.equal(calls[0], input);
  assert.equal(context.__eventrunnerWebMcpTest.descriptors()[0].inputSchema, schema);
  assert.equal(context.__eventrunnerWebMcpTest.evidence, 'injected-test-double');
});

test('duplicate registrations remain visible even if the app catches the error', async () => {
  const context = await browser();
  const definition = { name: 'diagnostic', execute: () => ({}) };
  context.document.modelContext.registerTool(definition);
  assert.throws(() => context.document.modelContext.registerTool(definition), /Duplicate tool/);
  assert.equal(context.__eventrunnerWebMcpTest.failures.length, 1);
  assert.equal(context.__eventrunnerWebMcpTest.registrations.length, 1);
});

test('unregistration removes discoverability and invocation', async () => {
  const context = await browser();
  context.document.modelContext.registerTool({ name: 'diagnostic', execute: () => ({}) });
  context.document.modelContext.unregisterTool('diagnostic');
  assert.equal(context.__eventrunnerWebMcpTest.names().length, 0);
  assert.equal(context.__eventrunnerWebMcpTest.removals[0], 'diagnostic');
  await assert.rejects(context.__eventrunnerWebMcpTest.invoke('diagnostic'), /not registered/);
});

test('unsupported mode masks both host API surfaces', async () => {
  const context = await browser(false);
  assert.equal(context.document.modelContext, undefined);
  assert.equal(context.navigator.modelContext, undefined);
  assert.equal(context.__eventrunnerWebMcpTest.names().length, 0);
});
