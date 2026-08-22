'use strict';

/**
 * Site-publisher invoke hook (spec §8.4 phase 5, issue #36).
 *
 * §8.4's phase 2-4 degraded mode was a nightly snapshot refresh; phase 5
 * replaces it with an on-demand one. After `cmsPublish` has committed the
 * revision copy, this module asks the `site-publisher` Cloud Run job in the
 * SAME project to regenerate the static snapshot and redeploy hosting, so
 * the crawler-facing first paint catches up in minutes instead of at the
 * next deploy.
 *
 * Three properties this hook must have, all of them load-bearing:
 *
 *   Fail-soft. The publish already committed. An unreachable Cloud Run
 *   API, a missing IAM grant, or a job that does not exist must never turn
 *   a successful publish into a 500 for the admin who requested it — the
 *   content IS published; only the crawler snapshot lags, which is exactly
 *   the phase 2-4 state the platform shipped in. Every failure here is
 *   caught, recorded on the queue row, and reported as an OperatorEvent.
 *
 *   Bounded. The invoke is a single POST with a hard timeout, so a hung
 *   Cloud Run endpoint cannot hold the publish response open.
 *
 *   Presence-of-config gated (§8.4). A deployment without
 *   EVENT_SITE_PUBLISHER_JOB set has no publisher — deploy-client.yml
 *   writes that key into the functions env only when the client's
 *   EVENT_SITE_PUBLISHER_ENABLED is true. Unconfigured skips cleanly and
 *   writes nothing: a deployment that will never have a publisher should
 *   not accumulate publisher fields on every publish row.
 *
 * Status lives on the same `cmsPublishQueue` row the publish created
 * (§8.4: "cmsPublishQueue keeps its status field"), under two disjoint
 * fields so the function and the job never race each other:
 *
 *   publisher.invoke = { status: 'invoked'|'failed', at, executionName?,
 *                        error? }        written HERE, once per publish
 *   publisher.status = 'running'|'done'|'failed'
 *                                        written by the job itself
 *                                        (scripts/publish-site.cjs)
 */

const RUN_API_ROOT = 'https://run.googleapis.com/v2';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Hard cap on the whole invoke. The publish response waits on this. */
const INVOKE_TIMEOUT_MS = 10_000;

/**
 * Resolve the publisher from the runtime environment.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ configured: boolean, job?: string, projectId?: string,
 *             region?: string, reason?: string }}
 */
function resolvePublisherConfig(env = process.env) {
  const job = (env.EVENT_SITE_PUBLISHER_JOB || '').trim();
  if (!job) return { configured: false, reason: 'no-job-configured' };
  const projectId = (env.EVENT_FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    // Configured-but-unusable is a deployment bug, not a "no publisher
    // here" state, and it must read differently on the queue row.
    return { configured: false, reason: 'no-project-id' };
  }
  return {
    configured: true,
    job,
    projectId,
    region: (env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1',
  };
}

/**
 * The job's fully qualified Cloud Run v2 resource name.
 * @param {{ projectId: string, region: string, job: string }} config
 */
function jobResourceName({ projectId, region, job }) {
  return `projects/${projectId}/locations/${region}/jobs/${job}`;
}

/**
 * Access token for the functions runtime service account, from the
 * instance metadata server.
 *
 * Read from metadata rather than through google-auth-library: the token is
 * one unauthenticated localhost GET, the library is not a declared
 * dependency of this package (it is only a transitive one of
 * firebase-admin), and depending on a transitive package is how a minor
 * firebase-admin bump breaks publishing.
 *
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} deps
 * @returns {Promise<string>}
 */
async function fetchAccessToken({ fetchImpl = globalThis.fetch, signal } = {}) {
  const response = await fetchImpl(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`metadata server responded ${response.status} for an access token`);
  }
  const body = await response.json();
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('metadata server returned no access_token');
  }
  return body.access_token;
}

/**
 * Start one execution of the job, passing the queue row id through as a
 * per-execution container override so the job can write its own terminal
 * status back to that exact row.
 *
 * @param {{
 *   config: { projectId: string, region: string, job: string },
 *   queueId: string|null,
 *   fetchImpl?: typeof fetch,
 *   getAccessToken?: (deps: object) => Promise<string>,
 *   timeoutMs?: number,
 * }} deps
 * @returns {Promise<{ executionName: string|null }>} throws on any failure
 */
async function invokeSitePublisher({
  config,
  queueId = null,
  fetchImpl = globalThis.fetch,
  getAccessToken = fetchAccessToken,
  timeoutMs = INVOKE_TIMEOUT_MS,
}) {
  // One deadline for token + POST together: two independent timeouts would
  // let the worst case be twice what the caller was promised.
  const signal = AbortSignal.timeout(timeoutMs);
  const token = await getAccessToken({ fetchImpl, signal });

  const body = {
    ...(queueId
      ? {
        overrides: {
          containerOverrides: [{ env: [{ name: 'PUBLISH_QUEUE_ID', value: queueId }] }],
        },
      }
      : {}),
  };

  const response = await fetchImpl(`${RUN_API_ROOT}/${jobResourceName(config)}:run`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // Body unreadable; the status alone still names the failure class
      // (403 = the run.invoker grant, 404 = the job was never created).
    }
    throw new Error(`Cloud Run responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  let executionName = null;
  try {
    const payload = await response.json();
    // :run returns a long-running Operation whose metadata is the
    // Execution; either name is enough to find the run in the console.
    executionName = payload?.metadata?.name || payload?.name || null;
  } catch {
    // A 2xx with an unparseable body still means the execution started.
  }
  return { executionName };
}

/**
 * The whole hook, as `cmsPublish` calls it. Never throws.
 *
 * @param {{
 *   db: object,
 *   queueId: string|null,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   getAccessToken?: (deps: object) => Promise<string>,
 *   notifyOperator?: (event: object) => Promise<unknown>,
 *   timeoutMs?: number,
 *   now?: () => number,
 *   log?: Console,
 * }} deps
 * @returns {Promise<{ status: 'skipped'|'invoked'|'failed', reason?: string,
 *                     executionName?: string|null, error?: string }>}
 */
async function requestSitePublish({
  db,
  queueId,
  env = process.env,
  fetchImpl,
  getAccessToken,
  notifyOperator = async () => {},
  timeoutMs = INVOKE_TIMEOUT_MS,
  now = Date.now,
  log = console,
}) {
  const config = resolvePublisherConfig(env);
  if (!config.configured) {
    // Nothing written: a deployment with no publisher gets no publisher
    // fields on its rows (§8.4 phase 2-4 behavior, unchanged).
    return { status: 'skipped', reason: config.reason };
  }
  if (!queueId) {
    // A no-op publish creates no row (publish.cjs returns queueId: null),
    // and there is nothing new to snapshot either.
    return { status: 'skipped', reason: 'no-queue-row' };
  }

  const ref = db.collection('cmsPublishQueue').doc(queueId);
  try {
    const { executionName } = await invokeSitePublisher({
      config, queueId, fetchImpl, getAccessToken, timeoutMs,
    });
    await ref.set(
      { publisher: { invoke: { status: 'invoked', at: new Date(now()), executionName } } },
      { merge: true },
    );
    return { status: 'invoked', executionName };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 500);
    log.error(`cmsPublish: site-publisher invoke failed (publish itself committed): ${error}`);
    // Recording the failure must not be able to fail the publish either.
    try {
      await ref.set(
        { publisher: { invoke: { status: 'failed', at: new Date(now()), error } } },
        { merge: true },
      );
    } catch (markErr) {
      log.error(`cmsPublish: could not record the publisher invoke failure: ${markErr?.message || markErr}`);
    }
    try {
      await notifyOperator({
        kind: 'error',
        title: 'Site publisher could not be invoked',
        summary:
          'The CMS publish committed, but the site-publisher Cloud Run job did not start, so the ' +
          'static snapshot crawlers see is stale until the next deploy or a manual execution.',
        fields: {
          job: jobResourceName(config),
          queueId,
          error,
        },
        // Per job, not per publish: a broken IAM grant fails every publish,
        // and one alert per five minutes is the useful volume.
        dedupeKey: `site-publisher-invoke-failed:${config.job}`,
      });
    } catch (notifyErr) {
      log.warn(`cmsPublish: operator notification failed: ${notifyErr?.message || notifyErr}`);
    }
    return { status: 'failed', error };
  }
}

module.exports = {
  requestSitePublish,
  resolvePublisherConfig,
  invokeSitePublisher,
  fetchAccessToken,
  jobResourceName,
  internals: { RUN_API_ROOT, METADATA_TOKEN_URL, INVOKE_TIMEOUT_MS },
};
