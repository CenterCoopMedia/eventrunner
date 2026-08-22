'use strict';

/**
 * TicketingProvider registry (spec §3.3). Dispatch on
 * EVENT_TICKETING_PROVIDER — the same shape as the email registry
 * (`email/providers/index.cjs`), with two deliberate differences:
 *
 *   1. There is no emulator default. EVENT_TICKETING_PROVIDER is a
 *      REQUIRED_ALWAYS key (packages/shared/src/config/deploy.cjs), and
 *      `none` is already the safe, fully functional value — so an unset
 *      variable is a misconfiguration to surface, not a hole to paper over.
 *   2. The eventbrite (#30) and manual (#31) adapters were separate issues,
 *      both now landed. They are wired here by NAME rather than by an
 *      explicit map entry — adding `providers/<name>.cjs` exporting
 *      `create<Name>Provider` is the whole registration (loadAdapterFactory,
 *      below). A future name not yet backed by a file still fails with a
 *      message that says so, rather than with a raw MODULE_NOT_FOUND.
 *
 * `externalEventId` is read once, at construction, from
 * EVENT_TICKETING_EVENT_ID (§3.3) — one field, so the two-name duplication
 * the reference implementation carried cannot recur.
 */

const { createNoneProvider } = require('./none.cjs');

/** The three valid EVENT_TICKETING_PROVIDER values (shared/config/deploy.cjs). */
const PROVIDER_NAMES = ['eventbrite', 'manual', 'none'];

/**
 * Providers that implement `registerWebhook` (§3.3). This is a static
 * capability table because it is consulted at DEPLOY-ANALYSIS time, to
 * decide which secrets a function binds — the adapter itself cannot be
 * constructed there (it would need the very secrets being decided on).
 * An adapter that gains or loses `registerWebhook` must be moved here in
 * the same change; the registry contract test pins the two against each
 * other for every adapter present in the build.
 */
const WEBHOOK_CAPABLE_PROVIDERS = new Set(['eventbrite']);

/** Methods every TicketingProvider must implement (§3.3). */
const REQUIRED_METHODS = ['verifyWebhook', 'fetchOrder', 'listTickets', 'getRegistrationPrompt'];

/** Methods a provider MAY implement; absence is a capability answer, not a fault (§3.3). */
const OPTIONAL_METHODS = ['lookupByOrderNumber', 'registerWebhook'];

/**
 * Adapter modules by provider name. Required lazily so that a deployment
 * running `none` never loads an adapter's dependencies, and so a missing
 * (not-yet-written) adapter reports itself in the vocabulary of the spec.
 *
 * @param {string} name @returns {Function} the adapter factory
 */
function loadAdapterFactory(name) {
  const file = `./${name}.cjs`;
  const factoryName = `create${name[0].toUpperCase()}${name.slice(1)}Provider`;
  let mod = null;
  try {
    mod = require(file);
  } catch (err) {
    if (err?.code === 'MODULE_NOT_FOUND' && String(err.message).includes(file)) {
      throw new Error(
        `EVENT_TICKETING_PROVIDER is "${name}", but that adapter is not part of this build ` +
        `(functions/src/ticketing/providers/${name}.cjs does not exist). ` +
        'Set EVENT_TICKETING_PROVIDER=none until it ships.'
      );
    }
    throw err;
  }
  if (typeof mod?.[factoryName] !== 'function') {
    throw new Error(`ticketing adapter ${file} does not export ${factoryName}()`);
  }
  return mod[factoryName];
}

/**
 * Built-in factories. `none` is the only one: it must work with no adapter
 * file present (the safe default, spec §3.3). `manual` and `eventbrite` are
 * both resolved lazily by loadAdapterFactory below — providers/manual.cjs
 * and providers/eventbrite.cjs existing and exporting `createManualProvider`
 * / `createEventbriteProvider` was the whole registration for issues #31
 * and #30, exactly as the module doc above promises. This registry needed
 * no edit for either to land.
 */
const BUILT_IN_FACTORIES = { none: createNoneProvider };

/**
 * Throw unless `provider` satisfies the §3.3 interface. Called on every
 * constructed provider — a registry that hands back a half-implemented
 * object turns one adapter bug into a webhook endpoint that 500s on every
 * delivery.
 *
 * @param {object} provider
 * @param {string} expectedName
 * @returns {object} the same provider
 */
function assertProviderContract(provider, expectedName) {
  if (!provider || typeof provider !== 'object') {
    throw new Error(`ticketing provider "${expectedName}" factory returned no provider`);
  }
  if (provider.name !== expectedName) {
    throw new Error(
      `ticketing provider name mismatch: EVENT_TICKETING_PROVIDER is "${expectedName}" ` +
      `but the adapter reports "${provider.name}"`
    );
  }
  if (!('externalEventId' in provider)) {
    throw new Error(`ticketing provider "${expectedName}" does not expose externalEventId`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`ticketing provider "${expectedName}" is missing ${method}()`);
    }
  }
  for (const method of OPTIONAL_METHODS) {
    if (provider[method] !== undefined && typeof provider[method] !== 'function') {
      throw new Error(`ticketing provider "${expectedName}" declares ${method} but it is not a function`);
    }
  }
  return provider;
}

/**
 * Select and construct the configured provider.
 *
 * @param {{ env?: Record<string, string|undefined>, fetchImpl?: typeof fetch,
 *           factories?: Record<string, Function>, db?: object,
 *           getConfig?: () => Promise<object> }} [deps]
 *   `factories` is a test seam; it never reaches production code paths.
 *   `db`/`getConfig` are forwarded to the adapter factory unchanged — the
 *   `manual` adapter needs both (it reads/writes `tickets/{externalId}`
 *   directly and reads `config/event.registration.externalUrl` for §3.5);
 *   `none` and `eventbrite` ignore what they do not need. Nothing in this
 *   module imports firebase-admin itself (core/firestore.cjs's job) — `db`
 *   only ever arrives here already constructed by the caller.
 * @returns {object} TicketingProvider (spec §3.3)
 */
function getTicketingProvider({ env = process.env, fetchImpl, factories, db, getConfig } = {}) {
  const raw = typeof env.EVENT_TICKETING_PROVIDER === 'string'
    ? env.EVENT_TICKETING_PROVIDER.trim()
    : env.EVENT_TICKETING_PROVIDER;

  if (raw === undefined || raw === null || raw === '') {
    throw new Error(
      'EVENT_TICKETING_PROVIDER is not set. Set it to one of: ' +
      `${PROVIDER_NAMES.join(', ')} (none is a working configuration — see spec §3.3).`
    );
  }
  if (!PROVIDER_NAMES.includes(raw)) {
    throw new Error(
      `Unknown EVENT_TICKETING_PROVIDER "${raw}". Expected one of: ${PROVIDER_NAMES.join(', ')}.`
    );
  }

  const override = factories?.[raw];
  const factory = typeof override === 'function'
    ? override
    : BUILT_IN_FACTORIES[raw] || loadAdapterFactory(raw);

  return assertProviderContract(factory({ env, fetchImpl, db, getConfig }), raw);
}

/**
 * Secret names a ticketing function must bind (spec §8.2), decided from
 * configuration alone — binding a secret the deployment never created
 * fails the deploy, so each function binds only what its own runtime path
 * can read.
 *
 *   TICKETING_API_TOKEN      — whenever the provider is not `none`
 *   TICKETING_WEBHOOK_SECRET — only for providers that implement
 *                              registerWebhook (§3.3): eventbrite today,
 *                              never manual. Capability, not enablement.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string[]}
 */
function ticketingSecretNames(env = process.env) {
  const name = typeof env.EVENT_TICKETING_PROVIDER === 'string'
    ? env.EVENT_TICKETING_PROVIDER.trim()
    : '';
  if (!PROVIDER_NAMES.includes(name) || name === 'none') return [];
  const secrets = ['TICKETING_API_TOKEN'];
  if (WEBHOOK_CAPABLE_PROVIDERS.has(name)) secrets.push('TICKETING_WEBHOOK_SECRET');
  return secrets;
}

/**
 * Whether a provider NAME is expected to support webhook registration —
 * the deploy-time half of the §3.3 capability gate. The runtime half is
 * `typeof provider.registerWebhook === 'function'`, which is what
 * getTicketingStatus and scripts/register-ticketing-webhook.cjs consult.
 *
 * @param {string} name @returns {boolean}
 */
function providerNameSupportsWebhooks(name) {
  return WEBHOOK_CAPABLE_PROVIDERS.has(typeof name === 'string' ? name.trim() : '');
}

module.exports = {
  getTicketingProvider,
  ticketingSecretNames,
  providerNameSupportsWebhooks,
  assertProviderContract,
  PROVIDER_NAMES,
  WEBHOOK_CAPABLE_PROVIDERS,
  REQUIRED_METHODS,
  OPTIONAL_METHODS,
  internals: { loadAdapterFactory },
};
