'use strict';

/**
 * Read an event data package back (issue #329): the consumer half of
 * eventPackage.cjs. `scripts/export-event-package.cjs --verify` runs it on a
 * saved zip, and the tests run it on every package they build, so the
 * format the README documents is the format a reader can actually use.
 *
 * `verifyEventPackage` checks three things:
 *
 *   1. The manifest: its format name, its schema version, and that every
 *      file it lists is in the zip with the same SHA-256 and record count.
 *   2. No file outside the manifest, README.md and manifest.json.
 *   3. The relationships the manifest names: each reference resolves to a
 *      record in the target file. A reference that does not resolve is
 *      reported with a count, not treated as damage: a speaker can be
 *      deleted after a session named them, and an admission from an
 *      external ticketing source names an order this deployment never held.
 *
 * Pure: a Buffer in, a report out. Reads stored and deflated entries only,
 * the two methods yazl writes.
 */

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const FORMAT = 'eventrunner-event-data-package';
const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);

/** At most this many unresolved ids are named per relationship. */
const SAMPLE_SIZE = 5;

/**
 * The entries of a zip, from its central directory.
 *
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>} entry name → uncompressed bytes
 */
function readZipEntries(buffer) {
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a zip archive.');
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('The zip directory is damaged.');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const data = buffer.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, zlib.inflateRawSync(data));
    else throw new Error(`${name}: compression method ${method} is not supported.`);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The package's files keyed by their path inside the package folder.
 *
 * @param {Buffer} buffer
 * @returns {{ folder: string, files: Map<string, Buffer> }}
 */
function readEventPackage(buffer) {
  const entries = readZipEntries(buffer);
  const manifestName = [...entries.keys()].find((name) => /^[^/]+\/manifest\.json$/.test(name));
  if (!manifestName) throw new Error('The package has no manifest.json.');
  const folder = manifestName.slice(0, manifestName.indexOf('/'));
  const files = new Map();
  for (const [name, data] of entries) {
    if (!name.startsWith(`${folder}/`)) throw new Error(`${name}: is outside the package folder.`);
    files.set(name.slice(folder.length + 1), data);
  }
  return { folder, files };
}

/** The values a field holds on one record: `name[]` reads a list. */
function referencesOf(record, field) {
  if (field.endsWith('[]')) {
    const value = record?.[field.slice(0, -2)];
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry) : [];
  }
  const value = record?.[field];
  return typeof value === 'string' && value ? [value] : [];
}

/**
 * Check a package. `ok` is false only for damage: a bad manifest, a
 * missing or changed file, or an unexpected file.
 *
 * @param {Buffer} buffer
 * @returns {{ ok: boolean, manifest: object|null, problems: string[],
 *             counts: Record<string, number|null>,
 *             relationships: Array<{ from: string, field: string, to: string,
 *                                    checked: number, unresolved: number, sample: string[] }> }}
 */
function verifyEventPackage(buffer) {
  const problems = [];
  let pkg;
  try {
    pkg = readEventPackage(buffer);
  } catch (err) {
    return { ok: false, manifest: null, problems: [err.message], counts: {}, relationships: [] };
  }
  let manifest;
  try {
    manifest = JSON.parse(pkg.files.get('manifest.json').toString('utf8'));
  } catch {
    return { ok: false, manifest: null, problems: ['manifest.json: is not valid JSON.'], counts: {}, relationships: [] };
  }
  if (manifest.format !== FORMAT) problems.push(`manifest.json: format must be ${FORMAT}.`);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
    problems.push(`manifest.json: schema version ${manifest.schemaVersion} is not supported.`);
  }
  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  const parsed = new Map();
  const counts = {};
  for (const file of listed) {
    const data = pkg.files.get(file.path);
    if (!data) {
      problems.push(`${file.path}: is listed in the manifest and missing from the package.`);
      continue;
    }
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    if (digest !== file.sha256) problems.push(`${file.path}: the checksum does not match the manifest.`);
    if (file.format === 'json') {
      try {
        const value = JSON.parse(data.toString('utf8'));
        parsed.set(file.path, value);
        const records = Array.isArray(value) ? value.length : null;
        if (records !== file.records) problems.push(`${file.path}: holds ${records} records; the manifest says ${file.records}.`);
      } catch {
        problems.push(`${file.path}: is not valid JSON.`);
      }
    }
    counts[file.path] = file.records ?? null;
  }
  const known = new Set(['manifest.json', 'README.md', ...listed.map((file) => file.path)]);
  for (const path of pkg.files.keys()) {
    if (!known.has(path)) problems.push(`${path}: is not listed in the manifest.`);
  }
  if (!pkg.files.has('README.md')) problems.push('README.md: is missing.');

  const relationships = [];
  for (const rel of Array.isArray(manifest.relationships) ? manifest.relationships : []) {
    const from = parsed.get(rel.from);
    const to = parsed.get(rel.to);
    if (!Array.isArray(from) || !Array.isArray(to)) continue;
    const ids = new Set(to.map((record) => record?.id));
    let checked = 0;
    const unresolved = [];
    for (const record of from) {
      for (const ref of referencesOf(record, rel.field)) {
        checked += 1;
        if (!ids.has(ref)) unresolved.push(ref);
      }
    }
    relationships.push({
      from: rel.from,
      field: rel.field,
      to: rel.to,
      checked,
      unresolved: unresolved.length,
      sample: [...new Set(unresolved)].slice(0, SAMPLE_SIZE),
    });
  }

  return { ok: problems.length === 0, manifest, problems, counts, relationships };
}

module.exports = { readEventPackage, readZipEntries, verifyEventPackage, FORMAT, SUPPORTED_SCHEMA_VERSIONS };
