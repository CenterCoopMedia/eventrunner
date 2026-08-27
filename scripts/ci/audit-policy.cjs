'use strict';

// CI audit policy (issue #103): fail the build only on high or critical
// findings in production dependencies (`npm audit --omit=dev`). Dev-tooling
// and build-only findings are never a red build here -- they are tracked in
// scripts/ci/audit-exceptions.json instead. A production high/critical
// finding also only passes when a reviewer has logged it in that same file;
// an unreviewed one still fails CI.
//
// This deliberately does not audit devDependencies at all. Dev-only tooling
// (firebase-tools, vite, and their transitive tar/uuid findings) is recorded
// in the exceptions file for visibility, but it can never fail this check --
// see the issue's decision that dev-tooling findings are logged, not gated.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXCEPTIONS_PATH = path.join(__dirname, 'audit-exceptions.json');
const FAIL_SEVERITIES = new Set(['high', 'critical']);

// Every workspace that carries its own package-lock.json gets audited on
// its own -- functions/ deploys from its own lockfile, independent of the
// root install, so a finding that only exists there must not slip past.
function auditTargets(repoRoot = REPO_ROOT) {
  const targets = ['.'];
  if (fs.existsSync(path.join(repoRoot, 'functions', 'package-lock.json'))) {
    targets.push('functions');
  }
  return targets;
}

function runAudit(target, repoRoot = REPO_ROOT, execFile = execFileSync) {
  const cwd = path.join(repoRoot, target);
  let stdout;
  try {
    stdout = execFile('npm', ['audit', '--omit=dev', '--json'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero as soon as it finds any vulnerability at all,
    // dev or prod severity notwithstanding -- that is expected, not a
    // failure of the audit itself. The JSON report is still on stdout.
    stdout = error.stdout;
  }
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new Error(`npm audit produced no output in ${target || '.'}`);
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (parseError) {
    // Fail closed: a malformed or truncated audit report must never read as
    // a clean audit. Surface it as a policy failure rather than passing CI
    // on missing evidence.
    throw new Error(`npm audit output in ${target || '.'} was not valid JSON: ${parseError.message}`);
  }
  if (!report || typeof report !== 'object' || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error(`npm audit output in ${target || '.'} is missing a "vulnerabilities" object`);
  }
  return report;
}

function loadExceptions(exceptionsPath = EXCEPTIONS_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(exceptionsPath, 'utf8');
  } catch (error) {
    throw new Error(`could not read the exceptions file at ${exceptionsPath}: ${error.message}`);
  }
  let exceptions;
  try {
    exceptions = JSON.parse(raw);
  } catch (parseError) {
    throw new Error(`the exceptions file at ${exceptionsPath} was not valid JSON: ${parseError.message}`);
  }
  if (!Array.isArray(exceptions)) {
    throw new Error(`the exceptions file at ${exceptionsPath} must contain a JSON array`);
  }
  for (const entry of exceptions) {
    if (!entry || typeof entry !== 'object' || typeof entry.package !== 'string' || !Array.isArray(entry.advisories)) {
      throw new Error(`every entry in ${exceptionsPath} needs a "package" string and an "advisories" array`);
    }
  }
  return exceptions;
}

// A finding's own `via` list is either advisory objects (with a `url`) or
// plain strings naming another vulnerable package one hop away. Walk that
// chain to collect every advisory URL reachable from a top-level finding, so
// an exception logged against the root advisory still matches a package
// several hops downstream of it.
function collectAdvisoryUrls(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const finding = vulnerabilities[name];
  if (!finding || !Array.isArray(finding.via)) return [];
  const urls = [];
  for (const via of finding.via) {
    if (typeof via === 'string') {
      urls.push(...collectAdvisoryUrls(via, vulnerabilities, seen));
    } else if (via && typeof via.url === 'string') {
      urls.push(via.url);
    }
  }
  return urls;
}

function isExcepted(name, advisoryUrls, exceptions) {
  return exceptions.some((entry) => {
    if (entry.package !== name) return false;
    if (entry.exposure !== 'production') return false;
    return entry.advisories.some((url) => advisoryUrls.includes(url));
  });
}

function evaluateReport(report, exceptions, target) {
  const failures = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!FAIL_SEVERITIES.has(finding.severity)) continue;
    const advisoryUrls = collectAdvisoryUrls(name, report.vulnerabilities);
    if (isExcepted(name, advisoryUrls, exceptions)) continue;
    failures.push({ target, name, severity: finding.severity, advisoryUrls });
  }
  return failures;
}

function checkAuditPolicy({
  repoRoot = REPO_ROOT,
  exceptionsPath = EXCEPTIONS_PATH,
  runAuditFn = runAudit,
  targets,
} = {}) {
  const exceptions = loadExceptions(exceptionsPath);
  const resolvedTargets = targets || auditTargets(repoRoot);
  const failures = [];
  for (const target of resolvedTargets) {
    const report = runAuditFn(target, repoRoot);
    failures.push(...evaluateReport(report, exceptions, target));
  }
  return { failures, targets: resolvedTargets };
}

function main() {
  const { failures, targets } = checkAuditPolicy();
  if (failures.length > 0) {
    console.error('Audit policy failed: unreviewed high or critical findings in production dependencies.');
    for (const failure of failures) {
      console.error(`  [${failure.target || '.'}] ${failure.name} (${failure.severity}) -- ${failure.advisoryUrls.join(', ') || 'no advisory URL reported'}`);
    }
    console.error(`Add a reviewed entry to ${path.relative(REPO_ROOT, EXCEPTIONS_PATH)} or fix the finding through a supported upgrade path.`);
    return 1;
  }
  console.log(`Audit policy passed: no unreviewed high or critical production findings (checked: ${targets.join(', ')}).`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Audit policy check failed to run: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  auditTargets,
  checkAuditPolicy,
  collectAdvisoryUrls,
  evaluateReport,
  isExcepted,
  loadExceptions,
  main,
  runAudit,
};
