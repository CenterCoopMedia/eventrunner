'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('provision-client.yml');
const writer = read('auto-deploy-enrollment.yml');
const deletion = read('decommission-client.yml');
const application = read('decommission-client-application.yml');
const enrollment = workflow.match(/\n  enroll-auto-deploy:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/)?.[1] || '';

test('only the short post-build enrollment job serializes the shared client-list update', () => {
  assert.match(enrollment, /needs: provision/);
  assert.ok(enrollment.includes("needs.provision.result == 'success'"));
  assert.ok(enrollment.includes('!inputs.test_mode'));
  assert.match(enrollment, /uses: \.\/\.github\/workflows\/auto-deploy-enrollment.yml/);
  assert.match(enrollment, /operation: enroll/);
  assert.match(writer, /concurrency:\s+group: auto-deploy-environments\s+cancel-in-progress: false\s+queue: max/);
  const workflowSettings = workflow.slice(0, workflow.indexOf('jobs:'));
  assert.ok(workflowSettings.includes('group: provision-${{ inputs.application_id }}'));
  assert.match(writer, /--application "\$APPLICATION_ID" --enroll-auto-deploy/);
  assert.match(writer, /--application "\$APPLICATION_ID" --remove-auto-deploy/);
});

test('enrollment uses the existing trusted identity and exposes only its App key', () => {
  assert.match(writer, /environment: provisioning/);
  assert.match(writer, /id-token: write/);
  assert.match(writer, /workload_identity_provider: \$\{\{ vars.WIF_PROVIDER \}\}/);
  assert.match(writer, /service_account: \$\{\{ vars.WIF_SERVICE_ACCOUNT \}\}/);
  assert.match(writer, /PROVISIONER_APP_PRIVATE_KEY: \$\{\{ secrets.PROVISIONER_APP_PRIVATE_KEY \}\}/);
  assert.doesNotMatch(writer, /CLOUDFLARE_API_TOKEN|POSTMARK_ACCOUNT_TOKEN|CONSOLE_POSTMARK_TOKEN|GITHUB_TOKEN:/);
});

test('decommission holds the per-application lock through automatic removal and deletion', () => {
  const caller = deletion.slice(deletion.indexOf('\n  decommission:'));
  assert.ok(caller.includes('group: provision-${{ matrix.application_id }}'));
  assert.match(caller, /uses: \.\/\.github\/workflows\/decommission-client-application.yml/);
  const removal = application.match(/\n  remove-auto-deploy:\n([\s\S]*?)(?=\n  decommission:)/)?.[1] || '';
  assert.match(removal, /inputs.event_name == 'schedule'.*inputs.mode == 'archive'.*inputs.mode == 'purge-now'/);
  assert.match(removal, /uses: \.\/\.github\/workflows\/auto-deploy-enrollment.yml/);
  assert.ok(removal.includes("inputs.event_name == 'schedule' && 'remove-due' || 'remove'"));
  assert.ok(removal.includes("inputs.mode == 'purge-now' && inputs.confirm_site"));
  const destructive = application.slice(application.indexOf('\n  decommission:'), application.indexOf('\n  restore-auto-deploy:'));
  assert.match(destructive, /needs: remove-auto-deploy/);
  assert.ok(destructive.includes("needs.remove-auto-deploy.result == 'success'"));
  assert.ok(destructive.includes("needs.remove-auto-deploy.result == 'skipped'"));
  assert.ok(!destructive.includes("result == 'failure'"));
  assert.match(destructive, /--purge-due --application "\$APPLICATION_ID"/);
});

test('a successful restore returns through the same serialized list writer', () => {
  const restored = application.slice(application.indexOf('\n  restore-auto-deploy:'));
  assert.match(restored, /needs: decommission/);
  assert.ok(restored.includes("inputs.mode == 'restore' && needs.decommission.result == 'success'"));
  assert.match(restored, /uses: \.\/\.github\/workflows\/auto-deploy-enrollment.yml/);
  assert.match(restored, /operation: restore/);
  assert.match(writer, /--restore-auto-deploy/);
});
