'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// The web build crosses a GitHub artifact boundary before Hosting predeploy.
const OFFLINE_INPUTS_FILE = 'offline-public-build.json';
const SHELL = 'app-shell.html';
const MAX_BYTES = 2_097_152;
const PUBLIC_FILE = /^(?:app-shell\.html|manifest\.webmanifest|branding\/favicon\.svg|fonts\/[\w-]+\.woff2|assets\/[\w.-]+\.(?:js|css))$/;

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function writeOfflinePublic(directory) {
  const inputs = path.join(directory, OFFLINE_INPUTS_FILE);
  if (!statSync(inputs, { throwIfNoEntry: false })?.isFile()) return;
  const { project, base, routes, generatedAt, files } = JSON.parse(readFileSync(inputs, 'utf8'));
  const assets = files.map((file) => {
    if (!PUBLIC_FILE.test(file)) throw new Error(`Invalid public offline asset: ${file}`);
    const contents = readFileSync(path.join(directory, file));
    return { file, size: contents.byteLength, hash: sha256(contents) };
  });
  if (!assets.some(({ file }) => file === SHELL)) throw new Error('Missing public offline shell');
  const bytes = assets.reduce((total, asset) => total + asset.size, 0);
  const build = { project, base, routes, generatedAt, assets, bytes };
  const code = readFileSync(path.join(__dirname, 'offline-worker.js'), 'utf8');
  const id = sha256(JSON.stringify(build) + code);
  writeFileSync(path.join(directory, 'sw.js'), `const BUILD = ${JSON.stringify({ ...build, id, maxBytes: MAX_BYTES })};\n${code}`);
  writeFileSync(path.join(directory, 'offline-policy.json'),
    `${JSON.stringify({ enabled: false, routes })}\n`);
  return bytes;
}

module.exports = { writeOfflinePublic, MAX_BYTES, OFFLINE_INPUTS_FILE };
