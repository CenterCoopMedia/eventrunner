import { describe, expect, it } from 'vitest';
import { PUBLIC_TOOL_DEFINITIONS, publicToolInternals } from './publicTools.js';

function state(overrides = {}) {
  return {
    pathname: '/schedule',
    eventConfig: {
      name: 'Test event',
      shortName: 'TEST',
      timezone: 'America/New_York',
      days: [{ id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' }],
      sender: { email: 'private@example.org' },
    },
    features: { schedule: true, webmcpPublic: true },
    theme: { preset: 'newsroom', mode: 'light', logos: { primary: 'secret/path.svg' } },
    pages: [{ id: 'schedule', label: 'Schedule', path: '/schedule', visible: true, systemPage: true }],
    scheduleData: [],
    configSource: 'snapshot',
    contentSource: 'snapshot',
    demoMode: false,
    ...overrides,
  };
}

describe('public WebMCP tools', () => {
  it('defines exactly four read-only tools with closed schemas', () => {
    expect(PUBLIC_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'get_event_context',
      'inspect_public_page',
      'check_public_schedule',
      'get_public_release_context',
    ]);
    for (const tool of PUBLIC_TOOL_DEFINITIONS) {
      expect(tool.inputSchema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
      expect(tool.annotations).toEqual({ readOnlyHint: true });
    }
  });

  it('uses route templates for identity-bearing public routes', () => {
    expect(publicToolInternals.publicPage(state({ pathname: '/attendees/user-123' }))).toEqual({
      type: 'attendee-profile',
      route: '/attendees/:uid',
      label: null,
      contentSource: 'generated-snapshot',
    });
  });

  it('returns bounded published sessions and omits sensitive source fields', () => {
    const scheduleData = Array.from({ length: 25 }, (_, index) => ({
      id: `internal-${index}`,
      dayId: 'day-1',
      startTime: '09:00',
      endTime: '10:00',
      title: `Session ${index}`,
      location: 'Room A',
      type: 'workshop',
      visible: index !== 24,
      attendeeEmail: 'private@example.org',
      ticketToken: 'secret',
      storagePath: 'private/path',
    }));
    const result = publicToolInternals.publicSchedule(state({ scheduleData }));

    expect(result.entries.total).toBe(24);
    expect(result.entries.items).toHaveLength(20);
    expect(result.entries.truncated).toBe(4);
    const json = JSON.stringify(result);
    expect(json).not.toContain('internal-');
    expect(json).not.toContain('private@example.org');
    expect(json).not.toContain('ticketToken');
    expect(json).not.toContain('storagePath');
  });

  it('reports malformed schedule facts without exposing a document id', () => {
    const result = publicToolInternals.publicSchedule(state({
      scheduleData: [{
        id: 'private-id',
        dayId: 'missing-day',
        startTime: '11:00',
        endTime: '10:00',
        title: '',
        visible: true,
      }],
    }));
    expect(result.issues.total).toBe(3);
    expect(JSON.stringify(result)).not.toContain('private-id');
  });

  it('returns only allowlisted event, feature, theme, and source fields', () => {
    const result = publicToolInternals.eventContext(state());
    expect(result.name).toBe('Test event');
    expect(result.enabledFeatures.items).toEqual(['schedule']);
    const json = JSON.stringify(result);
    expect(json).not.toContain('private@example.org');
    expect(json).not.toContain('secret/path.svg');
    expect(json).not.toContain('webmcpPublic');
  });
});

