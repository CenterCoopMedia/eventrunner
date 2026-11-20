'use strict';

const COMMAND = 'retire-airtable-functions';
// Remove this helper and its deploy call after all eight client environments
// have deployed a revision that removes the Airtable sync exports (#1242).
const AIRTABLE_FUNCTIONS = new Map([
  ['updateAirtablePitchSource', false],
  ['refreshAirtablePitches', false],
  ['scheduledAirtablePitchRefresh', true],
]);
const REGION = /^[a-z]+(?:-[a-z]+)+\d{1,2}$/;

function retirementTargets(project, inventory, localFunctions) {
  const declared = new Set(localFunctions.map(({ id }) => id));
  return inventory.filter(({ id }) => AIRTABLE_FUNCTIONS.has(id) && !declared.has(id))
    .map((endpoint) => {
      const { id, region, platform, codebase } = endpoint;
      const scheduled = AIRTABLE_FUNCTIONS.get(id);
      if (endpoint.project !== project || platform !== 'gcfv2' || codebase !== 'default'
          || !REGION.test(region) || (scheduled ? !endpoint.scheduleTrigger : !endpoint.httpsTrigger)) {
        throw new Error(`Unexpected deployed platform, codebase, region or trigger for Airtable function ${id}`);
      }
      return `${region}/${id}`;
    });
}

async function deleteIfPresent(remove) {
  try {
    return await remove();
  } catch (error) {
    if (error.status !== 404) throw error;
    return undefined;
  }
}

async function retireAirtableFunctions(project, targets, dependencies) {
  if (project !== process.env.EVENT_FIREBASE_PROJECT_ID?.trim() || !/^[a-z][a-z0-9-]+$/.test(project) || !targets.length) {
    throw new Error('Expected the deploy project and at least one Airtable function to retire');
  }
  const endpoints = targets.map((target) => {
    const [region, id, extra] = target.split('/');
    if (!REGION.test(region) || !AIRTABLE_FUNCTIONS.has(id) || extra !== undefined) {
      throw new Error('Unexpected Airtable function retirement target');
    }
    return { project, region, id };
  });
  const { authenticate, deleteSchedule, deleteFunction, pollDeletion } = dependencies ?? loadFirebase();
  await authenticate({ project, nonInteractive: true });
  for (const endpoint of endpoints) {
    if (AIRTABLE_FUNCTIONS.get(endpoint.id)) await deleteIfPresent(() => deleteSchedule(endpoint));
    const operation = await deleteIfPresent(() => deleteFunction(endpoint));
    if (operation) await pollDeletion(operation);
    console.log(`deploy-functions: retired Airtable function ${endpoint.id}(${endpoint.region})`);
  }
}

function loadFirebase() {
  const { requireAuth } = require('firebase-tools/lib/requireAuth.js');
  const { Client } = require('firebase-tools/lib/apiv2.js');
  const { functionsV2Origin } = require('firebase-tools/lib/api.js');
  const { functionName } = require('firebase-tools/lib/deploy/functions/backend.js');
  const { deleteJob, jobNameForEndpoint } = require('firebase-tools/lib/gcp/cloudscheduler.js');
  const { API_VERSION } = require('firebase-tools/lib/gcp/cloudfunctionsv2.js');
  const { pollOperation } = require('firebase-tools/lib/operation-poller.js');
  const functions = new Client({ urlPrefix: functionsV2Origin(), apiVersion: API_VERSION });
  return {
    authenticate: requireAuth,
    deleteSchedule: (endpoint) => deleteJob(jobNameForEndpoint(endpoint, endpoint.region)),
    // Firebase's functions:delete command matches dash-separated group prefixes.
    // Use the exact regional resource name and wait for its deletion to finish.
    deleteFunction: async (endpoint) => (await functions.delete(functionName(endpoint))).body,
    pollDeletion: (operation) => pollOperation({ apiOrigin: functionsV2Origin(), apiVersion: API_VERSION,
      operationResourceName: operation.name, masterTimeout: 25 * 60 * 1000 }),
  };
}

module.exports = { COMMAND, retirementTargets, retireAirtableFunctions };
