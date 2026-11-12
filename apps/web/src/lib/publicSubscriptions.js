import { matchRoutes } from 'react-router';
import { SPECIMEN_ENABLED } from '../pages/specimen/specimenRoute.js';

export const RUNTIME_COLLECTIONS = [
  'cmsContent', 'cmsPages', 'cmsUpdates', 'cmsSchedule',
  'cmsOrganizations', 'cmsTimeline', 'speakers_public',
];

const ALL_SUBSCRIPTIONS = [...RUNTIME_COLLECTIONS, 'badges'];
const BASE_COLLECTIONS = ['cmsContent', 'cmsPages'];

// Layout and RouteTitle always need the base collections. These are the
// additional streams read by each route, including its nested components.
export const PUBLIC_SUBSCRIPTION_ROUTES = [
  { path: '/', streams: ['cmsOrganizations', 'cmsTimeline'] },
  { path: '/schedule', streams: ['cmsSchedule', 'speakers_public'] },
  { path: '/schedule/mine', streams: ['cmsSchedule', 'speakers_public'] },
  { path: '/schedule/user/:uid', streams: ['cmsSchedule', 'speakers_public'] },
  { path: '/schedule/:sessionId', streams: ['cmsSchedule', 'speakers_public'] },
  { path: '/speakers', streams: ['speakers_public'] },
  { path: '/speakers/:slug', streams: ['speakers_public', 'cmsSchedule'] },
  { path: '/sponsors', streams: ['cmsOrganizations'] },
  { path: '/sponsors/:slug', streams: ['cmsOrganizations', 'cmsSchedule'] },
  { path: '/updates', streams: ['cmsUpdates'] },
  { path: '/updates/:id', streams: ['cmsUpdates'] },
  { path: '/pitch/:stepSlug?', streams: [] },
  { path: '/signin', streams: [] },
  { path: '/speaker/accept', streams: [] },
  { path: '/speaker/profile/:stepSlug?', streams: [] },
  { path: '/speaker/dashboard', streams: ['cmsSchedule', 'speakers_public'] },
  { path: '/ticket/claim', streams: [] },
  { path: '/tickets', streams: [] },
  { path: '/tickets/status', streams: [] },
  { path: '/tickets/mine', streams: [] },
  { path: '/registration/:stepSlug?', streams: [] },
  { path: '/profile', streams: ['badges'] },
  { path: '/profile/change-requests', streams: [] },
  { path: '/profile/organization', streams: [] },
  { path: '/dashboard', streams: ['cmsSchedule', 'badges'] },
  { path: '/attendees', streams: ['badges'] },
  { path: '/attendees/:uid', streams: ['badges'] },
  { path: '/attendees/posts/:postId', streams: [] },
  ...(SPECIMEN_ENABLED ? [{ path: '/specimen', streams: ['speakers_public'] }] : []),
  { path: '/admin/*', streams: ALL_SUBSCRIPTIONS },
];

/** Unknown/custom routes and preview need every stream; badges is config/badges. */
export function publicSubscriptionsForRoute(pathname, search = '', publicTools = false) {
  const route = typeof pathname === 'string'
    ? matchRoutes(PUBLIC_SUBSCRIPTION_ROUTES, pathname)?.at(-1)?.route
    : null;
  if (!route || new URLSearchParams(search).get('preview') === '1') return [...ALL_SUBSCRIPTIONS];

  const streams = new Set([...BASE_COLLECTIONS, ...route.streams]);
  // The enabled public schedule tool works from every public page.
  if (publicTools) streams.add('cmsSchedule');
  return [...streams];
}
