'use strict';

const assert = require('node:assert/strict');
const { createRouteMapStore } = require('./clientHostMapStore.cjs');

function fakeRouteMap() {
  const objects = new Map();
  const controls = { readFailure: false, beforeWrite: null };
  const bucket = 'public-client-routes-fixture';
  const error = (code) => Object.assign(new Error('Fixture object error'), { code });
  const file = (name) => ({
    async getMetadata() {
      const current = objects.get(name);
      if (!current) throw error(404);
      return [{ generation: current.generation, metadata: current.metadata }];
    },
    async save(contents, { metadata, preconditionOpts }) {
      const beforeWrite = controls.beforeWrite;
      controls.beforeWrite = null;
      if (beforeWrite) await beforeWrite();
      const generation = objects.get(name)?.generation ?? 0;
      if (preconditionOpts.ifGenerationMatch !== generation) throw error(412);
      assert.equal(metadata.cacheControl, 'no-store');
      assert.equal(metadata.contentType, 'application/json');
      objects.set(name, { generation: generation + 1, metadata: metadata.metadata, contents });
    },
  });
  const routeMaps = createRouteMapStore({
    bucket,
    getStorage: () => ({ bucket: (name) => {
      assert.equal(name, bucket);
      return { file };
    } }),
    fetchMap: async (href, options) => {
      const url = new URL(href);
      assert.equal(url.origin, 'https://storage.googleapis.com');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'manual');
      const [name, object] = url.pathname.slice(1).split('/');
      assert.equal(name, bucket);
      if (controls.readFailure) return new Response(null, { status: 503 });
      const current = objects.get(object);
      return current ? new Response(current.contents) : new Response(null, { status: 404 });
    },
  });
  return { routeMaps, controls };
}

module.exports = { fakeRouteMap };
