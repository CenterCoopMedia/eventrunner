import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_TOOL_DEFINITIONS, adminToolInternals } from './adminTools.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('admin WebMCP tools', () => {
  it('defines exactly six read-only tools with closed input schemas', () => {
    expect(ADMIN_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'check_event_readiness',
      'validate_current_page_draft',
      'inspect_publish_queue',
      'inspect_system_errors',
      'check_media_usage',
      'check_ticketing_health',
    ]);
    for (const tool of ADMIN_TOOL_DEFINITIONS) {
      expect(tool.inputSchema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
      expect(tool.annotations).toEqual({ readOnlyHint: true });
    }
  });

  it('binds the current route page and fixed endpoint outside model input', async () => {
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-event');
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ valid: true }),
    }));
    vi.stubGlobal('fetch', fetch);
    const tool = ADMIN_TOOL_DEFINITIONS.find(
      (definition) => definition.name === 'validate_current_page_draft',
    );
    const result = await tool.execute({}, {
      currentPageId: 'home',
      user: { getIdToken: async () => 'id-token' },
    });

    expect(result).toEqual({ ok: true, valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain('/webMcpValidateCurrentPageDraft');
    expect(JSON.parse(options.body)).toEqual({ pageId: 'home' });
    expect(options.headers.Authorization).toBe('Bearer id-token');
  });

  it('maps auth, input, unavailable, and temporary failures to stable codes', () => {
    expect(adminToolInternals.errorResult({ status: 401 }).error.code).toBe('signed-out');
    expect(adminToolInternals.errorResult({ status: 403 }).error.code).toBe('unauthorized');
    expect(adminToolInternals.errorResult({ status: 400 }).error.code).toBe('invalid-input');
    expect(adminToolInternals.errorResult({ status: 409, message: 'Unavailable.' }).error.code)
      .toBe('unavailable-diagnostic');
    expect(adminToolInternals.errorResult({ status: 500 }).error.code)
      .toBe('temporary-server-failure');
  });
});
