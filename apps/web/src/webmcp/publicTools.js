const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({}),
  additionalProperties: false,
});

const READ_ONLY = Object.freeze({ readOnlyHint: true });
const MAX_DAYS = 10;
const MAX_FEATURES = 10;
const MAX_SCHEDULE_ENTRIES = 20;
const MAX_SCHEDULE_ISSUES = 20;
const PUBLIC_FEATURE_KEYS = Object.freeze([
  'schedule',
  'speakers',
  'sponsors',
  'attendeeDirectory',
  'liveUpdates',
  'feedbackInbox',
  'schedulePdf',
  'icsExport',
  'updates',
]);

function text(value, maxLength = 160) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function bounded(items, limit) {
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: Math.max(0, items.length - limit),
  };
}

function routeContext(pathname, pages) {
  const exactPage = pages.find(
    (page) => page?.visible !== false && page.path === pathname,
  );
  if (exactPage) {
    return {
      type: exactPage.systemPage ? exactPage.id : 'content',
      route: text(pathname, 200),
      label: text(exactPage.label),
    };
  }

  const routes = [
    [/^\/schedule\/[^/]+$/, 'session', '/schedule/:sessionId'],
    [/^\/speakers\/[^/]+$/, 'speaker', '/speakers/:slug'],
    [/^\/updates\/[^/]+$/, 'update', '/updates/:id'],
    [/^\/attendees\/[^/]+$/, 'attendee-profile', '/attendees/:uid'],
    [/^\/speaker\//, 'speaker-account', '/speaker/:action'],
    [/^\/ticket\//, 'ticket-account', '/ticket/:action'],
  ];
  const match = routes.find(([pattern]) => pattern.test(pathname));
  return match
    ? { type: match[1], route: match[2], label: null }
    : { type: 'unknown', route: text(pathname, 200), label: null };
}

function eventContext(state) {
  const { eventConfig = {}, features = {}, theme = {}, pathname = '/', pages = [] } = state;
  const days = Array.isArray(eventConfig.days)
    ? eventConfig.days.map((day) => ({
        label: text(day?.label),
        date: text(day?.date, 20),
        startTime: text(day?.startTime, 8),
        endTime: text(day?.endTime, 8),
      }))
    : [];
  const enabledFeatures = PUBLIC_FEATURE_KEYS.filter((key) => features[key] === true);

  return {
    name: text(eventConfig.name),
    shortName: text(eventConfig.shortName, 80),
    timezone: text(eventConfig.timezone, 80),
    page: routeContext(pathname, pages),
    days: bounded(days, MAX_DAYS),
    enabledFeatures: bounded(enabledFeatures, MAX_FEATURES),
    theme: {
      preset: text(theme.preset, 80),
      mode: text(theme.mode, 20),
      header: text(theme.header, 40),
    },
  };
}

function publicPage(state) {
  return {
    ...routeContext(state.pathname ?? '/', state.pages ?? []),
    contentSource: state.contentSource === 'live' ? 'live' : 'generated-snapshot',
  };
}

function publicSchedule(state) {
  const configuredDays = new Set(
    (Array.isArray(state.eventConfig?.days) ? state.eventConfig.days : [])
      .map((day) => day?.id)
      .filter((id) => typeof id === 'string'),
  );
  const published = (Array.isArray(state.scheduleData) ? state.scheduleData : [])
    .filter((session) => session?.visible === true);
  const entries = published.map((session) => ({
    day: text(session.dayId, 80),
    startTime: text(session.startTime, 8),
    endTime: text(session.endTime, 8),
    title: text(session.title),
    location: text(session.location),
    type: text(session.type, 40),
  }));
  const issues = [];
  for (const session of published) {
    if (!configuredDays.has(session.dayId)) {
      issues.push({ kind: 'unknown-day', title: text(session.title) });
    }
    if (typeof session.title !== 'string' || session.title.trim() === '') {
      issues.push({ kind: 'missing-title', day: text(session.dayId, 80) });
    }
    if (
      typeof session.startTime !== 'string' ||
      typeof session.endTime !== 'string' ||
      session.startTime >= session.endTime
    ) {
      issues.push({ kind: 'invalid-time', title: text(session.title) });
    }
  }

  return {
    publishedOnly: true,
    entries: bounded(entries, MAX_SCHEDULE_ENTRIES),
    issues: bounded(issues, MAX_SCHEDULE_ISSUES),
  };
}

function releaseContext(state) {
  return {
    build: state.demoMode ? 'demo' : 'client',
    generatedContentSchema: 1,
    configSource: state.configSource === 'live' ? 'live' : 'generated-snapshot',
    contentSource: state.contentSource === 'live' ? 'live' : 'generated-snapshot',
  };
}

export const PUBLIC_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'get_event_context',
    description: 'Read the current public event, route, dates, feature, and theme context.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY,
    execute: (_input, state) => eventContext(state),
  },
  {
    name: 'inspect_public_page',
    description: 'Read the current public page type, route, label, and content source.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY,
    execute: (_input, state) => publicPage(state),
  },
  {
    name: 'check_public_schedule',
    description: 'Check the bounded published schedule and report structural issues.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY,
    execute: (_input, state) => publicSchedule(state),
  },
  {
    name: 'get_public_release_context',
    description: 'Read the public build mode and generated or live content sources.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: READ_ONLY,
    execute: (_input, state) => releaseContext(state),
  },
]);

export const publicToolInternals = {
  bounded,
  eventContext,
  publicPage,
  publicSchedule,
  releaseContext,
  routeContext,
};

