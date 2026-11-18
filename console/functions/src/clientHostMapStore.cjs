'use strict';

const { createRouteMapReader, routeMapObject, validateRouteMap } = require('./clientHostMap.cjs');

class RouteMapError extends Error {}

function routeMapError(operation, error) {
  if (error instanceof RouteMapError) return error;
  const code = Number.isInteger(error?.code) ? ` (code ${error.code})` : '';
  return new RouteMapError(`${operation} failed${code}.`);
}

function createRouteMapStore({ bucket, getStorage, fetchMap }) {
  if (!bucket) return null;
  const read = createRouteMapReader({ bucket, fetchMap });
  const file = (host) => getStorage().bucket(bucket).file(routeMapObject(host));
  return {
    async read(host) {
      try {
        return await read(host);
      } catch (error) {
        throw routeMapError('Reading the public route map', error);
      }
    },
    async stat(host) {
      try {
        const [metadata] = await file(host).getMetadata();
        const version = Number(metadata.metadata?.routeMapVersion);
        if (!Number.isSafeInteger(version) || version < 1) throw new RouteMapError('The stored route map has no valid version.');
        if (!/^[1-9]\d*$/.test(metadata.generation)) throw new RouteMapError('The stored route map has no valid generation.');
        return { generation: metadata.generation, version };
      } catch (error) {
        if (error.code === 404) return { generation: 0, version: 0 };
        throw routeMapError('Reading the route map object metadata', error);
      }
    },
    async write(map, generation) {
      try {
        await file(map.host).save(JSON.stringify(map), {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: generation },
          metadata: {
            contentType: 'application/json', cacheControl: 'no-store',
            metadata: { routeMapVersion: String(map.version) },
          },
        });
        return true;
      } catch (error) {
        if (error.code === 412) return false;
        throw routeMapError('Writing the route map object', error);
      }
    },
  };
}

/** Publish and read back a projection. Return null if a peer changed the object. */
async function writeVerifiedRouteMap(store, map) {
  const { host } = map;
  validateRouteMap(map, host);
  const { generation, version } = await store.stat(host);
  if (version > map.version) return null;
  if (version < map.version && !(await store.write(map, generation))) return null;
  const readback = await store.read(host);
  if (readback?.version > map.version) return null;
  if (readback?.version !== map.version || JSON.stringify(readback.routes) !== JSON.stringify(map.routes)) {
    throw new RouteMapError('The public route map did not match the approved routes.');
  }
  try {
    const { version: servedVersion, exportedAt } = validateRouteMap(readback, host);
    return { version: servedVersion, exportedAt };
  } catch (error) {
    throw routeMapError('Validating the served route map', error);
  }
}

module.exports = { RouteMapError, createRouteMapStore, routeMapError, writeVerifiedRouteMap };
