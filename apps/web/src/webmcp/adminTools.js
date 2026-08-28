import { callAdminEndpoint } from '../admin/adminApi.js';

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
});
const READ_ONLY = Object.freeze({ readOnlyHint: true });

const TOOLS = Object.freeze([
  {
    name: 'check_event_readiness',
    description: 'Check the current event against the existing launch-readiness policy.',
    endpoint: 'webMcpCheckEventReadiness',
  },
  {
    name: 'validate_current_page_draft',
    description: 'Validate the draft for the page that is open in the admin editor.',
    endpoint: 'webMcpValidateCurrentPageDraft',
    body: (state) => ({ pageId: state.currentPageId }),
  },
  {
    name: 'inspect_publish_queue',
    description: 'Inspect bounded and redacted recent publish status.',
    endpoint: 'webMcpInspectPublishQueue',
  },
  {
    name: 'inspect_system_errors',
    description: 'Inspect bounded system-error kinds and times without messages or user data.',
    endpoint: 'webMcpInspectSystemErrors',
  },
  {
    name: 'check_media_usage',
    description: 'Check bounded media-reference counts without storage paths.',
    endpoint: 'webMcpCheckMediaUsage',
  },
  {
    name: 'check_ticketing_health',
    description: 'Check redacted ticketing integration and queue health.',
    endpoint: 'webMcpCheckTicketingHealth',
  },
]);

function errorResult(error) {
  if (error?.status === 401 || error?.code === 'unauthenticated') {
    return { ok: false, error: { code: 'signed-out', message: 'Sign in again.' } };
  }
  if (error?.status === 403 || error?.code === 'forbidden') {
    return { ok: false, error: { code: 'unauthorized', message: 'Admin access is required.' } };
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
    execute: (_input, state) => invokeTool(tool, state),
  })),
);

export const adminToolInternals = { errorResult, invokeTool, TOOLS };

