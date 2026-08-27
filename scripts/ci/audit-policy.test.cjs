'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkAuditPolicy,
  collectAdvisoryUrls,
  evaluateReport,
  isExcepted,
  loadExceptions,
} = require('./audit-policy.cjs');

function writeExceptions(dir, exceptions) {
  const exceptionsPath = path.join(dir, 'audit-exceptions.json');
  fs.writeFileSync(exceptionsPath, JSON.stringify(exceptions));
  return exceptionsPath;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-policy-test-'));
}

function cleanReport() {
  return {
    vulnerabilities: {
      leftpad: {
        severity: 'moderate',
        via: [
          {
            source: 1,
            name: 'leftpad',
            url: 'https://github.com/advisories/GHSA-clean-0000-0000',
            severity: 'moderate',
          },
        ],
      },
    },
  };
}

function highReport() {
  return {
    vulnerabilities: {
      'some-pkg': {
        severity: 'high',
        via: [
          {
            source: 2,
            name: 'some-pkg',
            url: 'https://github.com/advisories/GHSA-high-1111-1111',
            severity: 'high',
          },
        ],
      },
    },
  };
}

test('collectAdvisoryUrls walks string-linked via chains to the leaf advisory objects', () => {
  const vulnerabilities = {
    top: { via: ['middle'] },
    middle: {
      via: [
        { url: 'https://github.com/advisories/GHSA-leaf-0000-0000' },
      ],
    },
  };
  assert.deepEqual(collectAdvisoryUrls('top', vulnerabilities), [
    'https://github.com/advisories/GHSA-leaf-0000-0000',
  ]);
});

test('isExcepted requires a production-exposure entry naming the same advisory URL', () => {
  const exceptions = [
    { package: 'pkg', exposure: 'production', advisories: ['https://github.com/advisories/GHSA-a'] },
  ];
  assert.equal(isExcepted('pkg', ['https://github.com/advisories/GHSA-a'], exceptions), true);
  assert.equal(isExcepted('pkg', ['https://github.com/advisories/GHSA-b'], exceptions), false);
  assert.equal(isExcepted('other', ['https://github.com/advisories/GHSA-a'], exceptions), false);

  const buildOnly = [
    { package: 'pkg', exposure: 'build', advisories: ['https://github.com/advisories/GHSA-a'] },
  ];
  assert.equal(isExcepted('pkg', ['https://github.com/advisories/GHSA-a'], buildOnly), false);
});

test('evaluateReport ignores findings below the high/critical threshold', () => {
  const failures = evaluateReport(cleanReport(), [], 'root');
  assert.deepEqual(failures, []);
});

test('checkAuditPolicy passes on a clean audit', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, []);
  const { failures } = checkAuditPolicy({
    exceptionsPath,
    targets: ['.'],
    runAuditFn: () => cleanReport(),
  });
  assert.deepEqual(failures, []);
});

test('checkAuditPolicy fails on an unreviewed high or critical production finding', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, []);
  const { failures } = checkAuditPolicy({
    exceptionsPath,
    targets: ['.'],
    runAuditFn: () => highReport(),
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, 'some-pkg');
  assert.equal(failures[0].severity, 'high');
});

test('checkAuditPolicy passes on a high finding covered by a matching exception', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, [
    {
      package: 'some-pkg',
      exposure: 'production',
      severity: 'high',
      advisories: ['https://github.com/advisories/GHSA-high-1111-1111'],
      rationale: 'test fixture',
      reviewedBy: 'test',
      reviewDate: '2026-08-27',
    },
  ]);
  const { failures } = checkAuditPolicy({
    exceptionsPath,
    targets: ['.'],
    runAuditFn: () => highReport(),
  });
  assert.deepEqual(failures, []);
});

test('checkAuditPolicy fails closed on malformed audit output rather than passing', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, []);
  assert.throws(
    () => checkAuditPolicy({
      exceptionsPath,
      targets: ['.'],
      runAuditFn: () => {
        throw new Error('npm audit output in . was not valid JSON: Unexpected end of JSON input');
      },
    }),
    /not valid JSON/,
  );
});

test('loadExceptions rejects a non-array exceptions file', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, { not: 'an array' });
  assert.throws(() => loadExceptions(exceptionsPath), /must contain a JSON array/);
});

test('loadExceptions rejects an entry missing package or advisories', () => {
  const dir = tempDir();
  const exceptionsPath = writeExceptions(dir, [{ package: 'pkg' }]);
  assert.throws(() => loadExceptions(exceptionsPath), /needs a "package" string and an "advisories" array/);
});

test('the committed exceptions file is well-formed and matches the current audit', () => {
  const exceptions = loadExceptions(path.join(__dirname, 'audit-exceptions.json'));
  assert.ok(Array.isArray(exceptions));
  for (const entry of exceptions) {
    assert.equal(typeof entry.package, 'string');
    assert.ok(['production', 'build', 'devTooling'].includes(entry.exposure), `unexpected exposure on ${entry.package}`);
    assert.ok(['moderate', 'high', 'critical'].includes(entry.severity), `unexpected severity on ${entry.package}`);
    assert.ok(entry.advisories.length > 0, `${entry.package} needs at least one advisory`);
    assert.equal(typeof entry.rationale, 'string');
    assert.match(entry.reviewDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});
