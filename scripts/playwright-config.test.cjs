'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const configUrl = pathToFileURL(path.join(root, 'playwright.config.js')).href;
const loader = `
  const target = process.argv[1];
  if (target) process.env.E2E_APP_URL = target;
  else delete process.env.E2E_APP_URL;
  const config = (await import(process.argv[2])).default;
  process.stdout.write(config.webServer.command);
`;

function quoted(value) {
  if (process.platform === 'win32') return `"${value}"`;
  return `'${value}'`;
}

function commandFor(url, env = {}) {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', loader, url, configUrl],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    },
  );
}

function loadError(url) {
  try {
    commandFor(url);
  } catch (error) {
    return `${error.stderr || ''}${error.stdout || ''}`;
  }
  return '';
}

test('the default e2e server command quotes the loopback host and port', () => {
  const command = commandFor('', { E2E_APP_URL: 'http://localhost:4173' });
  assert.ok(command.includes(`--host ${quoted('127.0.0.1')}`));
  assert.ok(command.includes(`--port ${quoted('5173')}`));
});

test('an alternate loopback port stays quoted', () => {
  const command = commandFor('http://localhost:4173');
  assert.ok(command.includes(`--host ${quoted('localhost')}`));
  assert.ok(command.includes(`--port ${quoted('4173')}`));
});

test('any address in 127.0.0.0/8 is accepted', () => {
  const command = commandFor('http://127.0.0.2:5173');
  assert.ok(command.includes(`--host ${quoted('127.0.0.2')}`));
  assert.ok(command.includes(`--port ${quoted('5173')}`));
});

test('an IPv6 loopback host stays quoted', () => {
  const command = commandFor('http://[::1]:5173');
  assert.ok(command.includes(`--host ${quoted('[::1]')}`));
  assert.ok(command.includes(`--port ${quoted('5173')}`));
});

test('a hostname with a shell separator is refused', () => {
  const error = loadError('http://127.0.0.1;id');
  assert.match(error, /loopback address/);
  assert.doesNotMatch(error, /--host 127\.0\.0\.1;id/);
});

test('a non-loopback host is refused', () => {
  const error = loadError('http://example.com:5173');
  assert.match(error, /loopback address/);
});
