import { callAdminEndpoint } from '../admin/adminApi.js';

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
});
const READ_ONLY = Object.freeze({ readOnlyHint: true });

// Each tool names the admin tier it needs (issue #186), mirroring the tier
// its endpoint asks for in functions/src/admin/webMcpDiagnostics.cjs
// DIAGNOSTIC_TIERS. The registration mounts only the tools the signed-in
// tier holds; the server refuses the rest regardless.
const TOOLS = Object.freeze([
  {
    name: 'check_event_readiness',
    description: 'Check the current event against the existing launch-readiness policy.',
    endpoint: 'webMcpCheckEventReadiness',
    tier: 'staff',
  },
  {
    name: 'validate_current_page_draft',
    description: 'Validate the draft for the page that is open in the admin editor.',
    endpoint: 'webMcpValidateCurrentPageDraft',
    body: (state) => ({ pageId: state.currentPageId }),
    tier: 'staff',
  },
  {
    name: 'inspect_publish_queue',
    description: 'Inspect bounded and redacted recent publish status.',
    endpoint: 'webMcpInspectPublishQueue',
    tier: 'staff',
  },
  {
    name: 'inspect_system_errors',
    description: 'Inspect bounded system-error kinds and times without messages or user data.',
    endpoint: 'webMcpInspectSystemErrors',
    tier: 'operator',
  },
  {
    name: 'check_media_usage',
    description: 'Check bounded media-reference counts without storage paths.',
    endpoint: 'webMcpCheckMediaUsage',
    tier: 'staff',
  },
  {
    name: 'check_ticketing_health',
    description: 'Check redacted ticketing integration and queue health.',
    endpoint: 'webMcpCheckTicketingHealth',
    tier: 'staff',
  },
]);

function errorResult(error) {
  if (error?.status === 401 || error?.code === 'unauthenticated') {
    return { ok: false, error: { code: 'signed-out', message: 'Sign in again.' } };
  }
  if (error?.status === 403 || error?.code === 'forbidden') {
    // The server says which tier it wanted ('Operator access required.');
    // pass that through so a staff caller learns why, not only that.
    const message = typeof error?.message === 'string' && /operator/i.test(error.message)
      ? 'Operator access is required.'
      : 'Admin access is required.';
    return { ok: false, error: { code: 'unauthorized', message } };
  }
  if (error?.code === 'unavailable-diagnostic' || error?.status === 409) {
    return { ok: false, error: { code: 'unavailable-diagnostic', message: error.message } };
  }
  if (error?.status === 400 || error?.code === 'bad-request' || error?.code === 'invalid-input') {
    return { ok: false, error: { code: 'invalid-input', message: error.message } };
  }
  return {
    ok: false,
    error: {
      code: 'temporary-server-failure',
      message: 'The diagnostic is temporarily unavailable.',
    },
  };
}

async function invokeTool(tool, state) {
  if (!state.user || typeof state.user.getIdToken !== 'function') {
    return errorResult({ status: 401 });
  }
  try {
    const result = await callAdminEndpoint(
      tool.endpoint,
      tool.body ? tool.body(state) : {},
      () => state.user.getIdToken(),
    );
    return { ok: true, ...result };
  } catch (error) {
    return errorResult(error);
  }
}

export const ADMIN_TOOL_DEFINITIONS = Object.freeze(
  TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY,
    tier: tool.tier,
    execute: (_input, state) => invokeTool(tool, state),
  })),
);

/**
 * The definitions a signed-in tier may mount: an operator holds every tool,
 * staff hold the staff tools. An unknown tier holds none.
 *
 * @param {'operator'|'staff'|null|undefined} tier
 */
export function adminToolsForTier(tier) {
  if (tier === 'operator') return ADMIN_TOOL_DEFINITIONS;
  if (tier === 'staff') return ADMIN_TOOL_DEFINITIONS.filter((tool) => tool.tier === 'staff');
  return [];
}

export const adminToolInternals = { errorResult, invokeTool, TOOLS };

