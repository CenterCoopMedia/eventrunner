'use strict';

// ADR 0007 §1: the client console is its own Firebase project. The client
// deploy (deploy-client.yml with the root firebase.json) must never ship
// the console's functions, rules or web app to a client project, and the
// console must never point at the client code. These checks read the
// configuration files only, so they need no credentials.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the root firebase.json deploys only the client code', () => {
  const config = JSON.parse(read('firebase.json'));
  const functions = Array.isArray(config.functions) ? config.functions : [config.functions];
  assert.deepEqual(functions.map((entry) => entry.source), ['functions']);
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.equal(config.firestore.indexes, 'firestore.indexes.json');
  const hosting = Array.isArray(config.hosting) ? config.hosting : [config.hosting];
  assert.deepEqual(hosting.map((entry) => entry.public), ['apps/web/dist']);
  assert.ok(!read('firebase.json').includes('console/'), 'root firebase.json names no console path');
});

test('the client deploy workflows never select the console configuration', () => {
  for (const file of ['.github/workflows/deploy-client.yml', '.github/workflows/deploy.yml']) {
    const text = read(file);
    assert.ok(!/(?:^|[\s"'=])console\//mu.test(text), `${file} names no console/ path`);
    assert.ok(!/--config\b/u.test(text), `${file} passes no --config to the Firebase CLI`);
    assert.ok(!/(?:working-directory|cd)\s*:?\s+console\b/u.test(text), `${file} never runs in console/`);
  }
});

test('the console has its own Firebase configuration that names only console paths', () => {
  const config = JSON.parse(read('console/firebase.json'));
  assert.equal(config.functions.source, 'functions');
  assert.equal(config.firestore.rules, 'firestore.rules');
  assert.equal(config.firestore.indexes, 'firestore.indexes.json');
  assert.equal(config.hosting.public, 'web/dist');
  assert.ok(!config.storage, 'the console has no storage bucket in this slice');
  // The one path outside console/: the script that vendors the shared package.
  assert.deepEqual(config.functions.predeploy, ['node "$PROJECT_DIR/../scripts/prepare-functions.cjs"']);
  // Each path resolves inside console/, never to the client code.
  for (const file of ['functions/package.json', 'firestore.rules', 'firestore.indexes.json', 'web/index.html']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'console', file)), `console/${file} exists`);
  }
});

test('console hosting refuses framing and keeps sign-in pages out of search', () => {
  const config = JSON.parse(read('console/firebase.json'));
  const global = config.hosting.headers.find((rule) => rule.source === '**');
  const headers = Object.fromEntries(global.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers['content-security-policy'], "frame-ancestors 'none'");
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-robots-tag'], 'noindex');
});

// ADR 0007 Principle 5: the console runs the same answer rules as
// init-event.cjs. The shared package is the one thing the console
// functions take from outside console/, and it arrives as the vendored
// `shared` package (console/functions/vendor/shared.tgz), never as a
// relative path. Besides it they use only the Firebase SDKs, Stripe,
// pdf-lib with its font kit (the signer's copy of the agreement) and Node.
const FUNCTION_PACKAGES = Object.freeze(['shared', '@pdf-lib/fontkit', 'firebase-admin', 'firebase-functions', 'pdf-lib', 'stripe']);

function allowedFunctionImport(specifier) {
  if (specifier.startsWith('node:')) return true;
  return FUNCTION_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

test('console functions import only the shared package from outside console/', () => {
  const offenders = [];
  let sharedUsed = false;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'vendor') continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:c?js|mjs)$/u.test(entry.name)) {
        const text = fs.readFileSync(child, 'utf8');
        for (const [, specifier] of text.matchAll(/(?:require\(|from\s+|import\()\s*['"]([^'".][^'"]*)['"]/gu)) {
          if (!allowedFunctionImport(specifier)) offenders.push(`${path.relative(ROOT, child)} -> ${specifier}`);
          if (specifier === 'shared' || specifier.startsWith('shared/')) sharedUsed = true;
        }
      }
    }
  };
  walk(path.join(ROOT, 'console', 'functions'));
  assert.deepEqual(offenders, []);
  assert.ok(sharedUsed, 'the console checks answers with the shared package');
  const manifest = JSON.parse(read('console/functions/package.json'));
  assert.equal(manifest.dependencies.shared, 'file:./vendor/shared.tgz');
});

test('console code does not import the client functions or web app', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:c?js|jsx|mjs)$/u.test(entry.name)) {
        const text = fs.readFileSync(child, 'utf8');
        const specifiers = [...text.matchAll(/(?:require\(|from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/gu)];
        for (const [, specifier] of specifiers) {
          const target = path.resolve(path.dirname(child), specifier);
          if (!target.startsWith(path.join(ROOT, 'console') + path.sep)) {
            offenders.push(`${path.relative(ROOT, child)} -> ${specifier}`);
          }
        }
      }
    }
  };
  walk(path.join(ROOT, 'console'));
  assert.deepEqual(offenders, []);
});

test('console hosting keeps hashed files for a year and revalidates its pages', () => {
  const { headers, rewrites } = JSON.parse(read('console/firebase.json')).hosting;
  const cache = (source) => headers.find((rule) => rule.source === source)?.headers
    .find(({ key }) => key === 'Cache-Control')?.value;
  assert.match(cache('/assets/**'), /max-age=31536000, immutable/);
  assert.match(cache('!/@(assets|api)/**'), /max-age=0.*must-revalidate/);
  // A removed hashed file must not answer with the page: it would be kept for a year.
  assert.equal(rewrites.at(-1).source, '!/assets/**');
});
