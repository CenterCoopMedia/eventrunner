'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const STATIC_IMPORT_RE = /\b(?:import|export)\s*(?!\s*\()(?:(?:[^"'`;()]*?)\s*from\s*)?["']([^"']+)["']/g;

function listFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

function parseStaticImports(source) {
  return [...String(source).matchAll(STATIC_IMPORT_RE)].map((match) => match[1]);
}

function htmlAttribute(tag, name) {
  const match = new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(tag);
  return match ? match[1] : '';
}

function resolveHtmlAsset(dist, href) {
  const clean = String(href).split(/[?#]/, 1)[0].replace(/^\.\//, '');
  const assets = clean.lastIndexOf('/assets/');
  const relative = assets >= 0 ? clean.slice(assets + 1) : clean.replace(/^\/+/, '');
  const target = path.resolve(dist, relative);
  const root = path.resolve(dist);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function resolveImportedAsset(dist, importer, specifier) {
  if (!specifier.endsWith('.js') && !specifier.includes('.js?')) return null;
  const clean = specifier.split(/[?#]/, 1)[0];
  if (clean.startsWith('/')) return resolveHtmlAsset(dist, clean);
  if (!clean.startsWith('.')) return null;
  const target = path.resolve(path.dirname(importer), clean);
  const root = path.resolve(dist);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function gzipBytes(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length;
}

function relativeName(dist, file) {
  return path.relative(dist, file).replaceAll(path.sep, '/');
}

function measureBundle(distInput) {
  const dist = path.resolve(distInput);
  const indexPath = path.join(dist, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`bundle budget: missing ${indexPath}`);
  const html = fs.readFileSync(indexPath, 'utf8');
  const initial = new Set();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
    const name = tag.slice(1).split(/\s|>/, 1)[0].toLowerCase();
    const type = htmlAttribute(tag, 'type').toLowerCase();
    const rel = htmlAttribute(tag, 'rel').toLowerCase();
    const href = name === 'script' ? htmlAttribute(tag, 'src') : htmlAttribute(tag, 'href');
    if (!href) continue;
    if ((name === 'script' && type === 'module') || (name === 'link' && rel === 'modulepreload')) {
      const asset = resolveHtmlAsset(dist, href);
      if (asset && fs.existsSync(asset)) initial.add(asset);
    }
  }
  if (initial.size === 0) throw new Error('bundle budget: index.html names no module entry');

  const queue = [...initial];
  while (queue.length > 0) {
    const file = queue.shift();
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of parseStaticImports(source)) {
      const imported = resolveImportedAsset(dist, file, specifier);
      if (!imported || !fs.existsSync(imported) || initial.has(imported)) continue;
      initial.add(imported);
      queue.push(imported);
    }
  }

  const details = [...initial]
    .map((file) => {
      const buffer = fs.readFileSync(file);
      return { file: relativeName(dist, file), raw: buffer.length, gzip: gzipBytes(buffer) };
    })
    .sort((a, b) => b.raw - a.raw || a.file.localeCompare(b.file));
  const allJs = listFiles(dist).filter((file) => file.endsWith('.js'));
  const lazyChunks = allJs
    .filter((file) => !initial.has(path.resolve(file)))
    .map((file) => {
      const buffer = fs.readFileSync(file);
      return { file: relativeName(dist, file), raw: buffer.length, gzip: gzipBytes(buffer) };
    })
    .sort((a, b) => b.raw - a.raw || a.file.localeCompare(b.file));

  return {
    initial: {
      raw: details.reduce((total, item) => total + item.raw, 0),
      gzip: details.reduce((total, item) => total + item.gzip, 0),
      chunks: details.length,
      files: details,
    },
    lazyChunks,
  };
}

function checkBudget(measurement, budget) {
  const problems = [];
  for (const metric of ['raw', 'gzip']) {
    if (measurement.initial[metric] > budget.initial[metric]) {
      problems.push(`initial ${metric}: ${measurement.initial[metric]} > ${budget.initial[metric]}`);
    }
  }
  for (const chunk of measurement.lazyChunks) {
    for (const metric of ['raw', 'gzip']) {
      if (chunk[metric] > budget.lazyChunk[metric]) {
        problems.push(`${chunk.file} ${metric}: ${chunk[metric]} > ${budget.lazyChunk[metric]}`);
      }
    }
  }
  return problems;
}

function parseArgs(argv) {
  const options = { dist: 'apps/web/dist', json: false, budget: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--dist') options.dist = argv[++index];
    else if (arg === '--budget') options.budget = argv[++index];
    else throw new Error(`bundle budget: unknown argument ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const measurement = measureBundle(options.dist);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
    return 0;
  }
  const budgetPath = path.resolve(options.budget || path.join(__dirname, 'bundle-budget.json'));
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  const problems = checkBudget(measurement, budget);
  console.log(
    `bundle budget: ${measurement.initial.chunks} initial chunk(s), ` +
    `${measurement.initial.raw} raw bytes, ${measurement.initial.gzip} gzip bytes`,
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`- ${problem}`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkBudget, main, measureBundle, parseStaticImports };
