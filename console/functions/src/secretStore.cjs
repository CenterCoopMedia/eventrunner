'use strict';

/**
 * The console's Secret Manager, through its REST API, so no new package is
 * needed. `fetch` and `getAccessToken` are injected; tests use a fake.
 *
 * A store has writeSecret(id, value), readSecret(id) -> value or null,
 * versionStamp(id) -> a string that changes with each write, or null, and
 * deleteSecret(id), which does nothing when the secret is gone. Errors name
 * the step and the HTTP status only, never the value or a response body.
 */

const API = 'https://secretmanager.googleapis.com/v1';
const TIMEOUT_MS = 10_000;

function createSecretStore({ projectId, getAccessToken, fetch, log = console }) {
  const secretPath = (id) => `projects/${projectId}/secrets/${id}`;

  async function call(label, path, { method = 'GET', body, allow = [] } = {}) {
    if (!projectId) throw new Error(`secret ${label}: no project`);
    const { access_token: accessToken } = await getAccessToken();
    let response;
    try {
      response = await fetch(`${API}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Error(`secret ${label}: no answer`);
    }
    if (allow.includes(response.status)) return null;
    if (!response.ok) throw new Error(`secret ${label}: HTTP ${response.status}`);
    return response.json();
  }

  /** A failure here leaves an older token in a secret that disconnect or retention deletes whole. */
  async function destroyOlderVersions(id, keep) {
    try {
      const listed = await call('list', `${secretPath(id)}/versions?filter=${encodeURIComponent('state:ENABLED')}`);
      for (const { name } of listed?.versions || []) {
        if (name !== keep) await call('destroy', `${name}:destroy`, { method: 'POST', body: {} });
      }
    } catch (err) {
      log.error('console could not clear an older stored version', err.message);
    }
  }

  return {
    async writeSecret(id, value) {
      await call('create', `projects/${projectId}/secrets?secretId=${encodeURIComponent(id)}`, {
        method: 'POST', body: { replication: { automatic: {} } }, allow: [409],
      });
      const version = await call('add', `${secretPath(id)}:addVersion`, {
        method: 'POST', body: { payload: { data: Buffer.from(value, 'utf8').toString('base64') } },
      });
      await destroyOlderVersions(id, version?.name);
    },

    async readSecret(id) {
      const answer = await call('read', `${secretPath(id)}/versions/latest:access`, { allow: [404] });
      return answer ? Buffer.from(answer.payload.data, 'base64').toString('utf8') : null;
    },

    /** Holds no part of the value. A remade secret restarts its version numbers, so the time is part of it. */
    async versionStamp(id) {
      const version = await call('stamp', `${secretPath(id)}/versions/latest`, { allow: [404] });
      return version ? `${version.name}@${version.createTime}` : null;
    },

    async deleteSecret(id) {
      await call('delete', secretPath(id), { method: 'DELETE', allow: [404] });
    },
  };
}

module.exports = { createSecretStore };
