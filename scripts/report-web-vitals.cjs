'use strict';

const fs = require('node:fs');
const { COLLECTION, METRICS, summarizeVitals } = require('shared/webVitals');

const USAGE = 'Usage: node scripts/report-web-vitals.cjs --project PROJECT | --input FILE | --input -';

function readArgs(argv) {
  let project = null;
  let input = null;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--project' && flag !== '--input') throw new Error(USAGE);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(USAGE);
    if (flag === '--project') {
      if (project !== null) throw new Error(USAGE);
      project = value;
    } else {
      if (input !== null) throw new Error(USAGE);
      input = value;
    }
    index += 1;
  }
  if ((project === null) === (input === null)) throw new Error(USAGE);
  return { project, input };
}

function seededRecords(text) {
  const parsed = JSON.parse(text);
  const records = Array.isArray(parsed) ? parsed : parsed?.records;
  if (!Array.isArray(records)) throw new Error('Input must be a JSON array or an object with a records array.');
  return records;
}

function formatNumber(value) {
  return String(Number(Number(value).toPrecision(12)));
}

function formatValue(name, value) {
  if (value === null) return '-';
  if (value === Infinity) return 'overflow';
  const unit = METRICS[name].unit;
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
}

function formatReport(records) {
  const lines = ['route\tdevice\tmetric\tsamples\tp75 upper bound\tgood threshold\trating'];
  for (const row of summarizeVitals(records)) {
    const good = METRICS[row.name].good;
    lines.push([
      row.route,
      row.device,
      row.name,
      row.count,
      formatValue(row.name, row.p75),
      good === undefined ? '-' : `<= ${formatValue(row.name, good)}`,
      row.rating || '-',
    ].join('\t'));
  }
  return lines.join('\n');
}

async function readProject(projectId, now = Date.now) {
  const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    `report-web-vitals-${process.pid}-${Date.now()}`,
  );
  try {
    const snapshot = await getFirestore(app).collection(COLLECTION)
      .where('expiresAt', '>', new Date(now()))
      .get();
    return snapshot.docs.map((doc) => doc.data());
  } finally {
    await deleteApp(app);
  }
}

async function main(argv, {
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`),
  readFile = (path) => fs.readFileSync(path === '-' ? 0 : path, 'utf8'),
  projectReader = readProject,
} = {}) {
  try {
    const args = readArgs(argv);
    const records = args.project
      ? await projectReader(args.project)
      : seededRecords(readFile(args.input));
    stdout(formatReport(records));
    return 0;
  } catch (error) {
    stderr(error?.message || 'The Web Vitals report failed.');
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { readArgs, seededRecords, formatReport, readProject, main, USAGE };
