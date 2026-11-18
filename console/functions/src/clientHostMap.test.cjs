'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRouteMapReader, projectRouteMap, validateRouteMap } = require('./clientHostMap.cjs');
const { writeVerifiedRouteMap } = require('./clientHostMapStore.cjs');
const { fakeRouteMap } = require('./fakeRouteMap.cjs');

const host = 'client.example.test';
const exportedAt = '2026-11-18T21:00:00.000Z';

function enrollment(mount, site, state, publicTitle) {
  const identity = { appId: `application-${site}`, projectId: `er-${site}`, site, domain: host };
  return {
    identity,
    record: {
      appId: identity.appId, projectId: identity.projectId, host, mount, state, publicTitle,
      publicBase: `https://${host}${mount}/`, hostingOrigin: `https://${site}.web.app`,
      consent: { by: 'fixture-owner', orgId: 'fixture-organization' },
    },
  };
}

const conference = enrollment('/conference', 'conference-fixture', 'published', 'Conference');
const workshops = enrollment('/events/workshops', 'workshops-fixture', 'published', 'Workshops archive');

test('the public projection keeps only published titles and validated route bindings', () => {
  const map = projectRouteMap({ host, revision: 9, authority: 'fixture-approval' }, [
    workshops, enrollment('/draft', 'draft-fixture', 'enrolled', 'Unpublished title'), conference,
    enrollment('/retired', 'retired-fixture', 'retired', 'Retired title'),
    enrollment('/removed', 'removed-fixture', 'removed', 'Removed title'),
  ], exportedAt);
  assert.deepEqual(map, {
    host, version: 9, exportedAt,
    routes: [
      { mount: '/conference', publicTitle: 'Conference', hostingOrigin: 'https://conference-fixture.web.app' },
      { mount: '/events/workshops', publicTitle: 'Workshops archive', hostingOrigin: 'https://workshops-fixture.web.app' },
    ],
  });
  assert.equal(validateRouteMap(map, host).routes[1].assetBase, '/events/workshops/');
  assert.throws(() => validateRouteMap(map, 'different.example.test'));
  assert.throws(() => projectRouteMap({ host, revision: 9 }, [{ ...conference, identity: workshops.identity }], exportedAt));
  assert.throws(() => projectRouteMap({ host, revision: 9 }, [conference, enrollment('/conference/extra', 'nested-fixture', 'published', 'Nested')], exportedAt));
  assert.throws(() => createRouteMapReader({}), /bucket is missing or invalid/);
});

test('a generation conflict preserves the newer verified map and a readback failure withholds success', async () => {
  const { routeMaps, controls } = fakeRouteMap();
  const first = projectRouteMap({ host, revision: 1 }, [conference], exportedAt);
  const second = projectRouteMap({ host, revision: 2 }, [conference, workshops], exportedAt);
  const third = projectRouteMap({ host, revision: 3 }, [workshops], exportedAt);

  controls.beforeWrite = async () => {
    assert.deepEqual(await writeVerifiedRouteMap(routeMaps, second), { version: 2, exportedAt });
  };
  assert.equal(await writeVerifiedRouteMap(routeMaps, first), null);
  assert.deepEqual(await routeMaps.read(host), second);

  controls.readFailure = true;
  await assert.rejects(writeVerifiedRouteMap(routeMaps, third), /Reading the public route map failed \(code 503\)/);
  controls.readFailure = false;
  assert.deepEqual(await writeVerifiedRouteMap(routeMaps, third), { version: 3, exportedAt });
  assert.deepEqual(await routeMaps.read(host), third);
});
