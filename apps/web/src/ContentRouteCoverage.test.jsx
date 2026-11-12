// Render the real routes, including signed-in nested consumers. Recording
// context reads makes a new consumer fail here until its route gets a stream.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AppRoutes } from './App.jsx';
import AuthContext from './contexts/AuthContext.jsx';
import ContentContext, { ContentProvider, useContent } from './contexts/ContentContext.jsx';
import EventConfigContext, { EventConfigProvider, useEventConfig } from './contexts/EventConfigContext.jsx';
import ProfileContext from './contexts/ProfileContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import { adminRoute, publicRoutes } from './routes.jsx';
import { PUBLIC_SUBSCRIPTION_ROUTES, publicSubscriptionsForRoute } from './lib/publicSubscriptions.js';
import { eventConfig, features } from '@generated/eventConfig.js';
import scheduleData, { speakers } from '@generated/scheduleData.js';
import organizations from '@generated/organizationsData.js';
import pages from '@generated/pagesData.js';

const { configDocs, contentDocs } = vi.hoisted(() => ({ configDocs: {}, contentDocs: {} }));
vi.mock('./lib/configSource.js', () => ({
  subscribeConfigDoc: (id, onNext, onStatus) => {
    onNext(configDocs[id] ?? null);
    onStatus?.('confirmed');
    return () => {};
  },
}));
vi.mock('./lib/contentSource.js', () => ({
  subscribeContentCollection: (name, _readSource, onNext) => {
    if (contentDocs[name]) onNext(contentDocs[name]);
    return () => {};
  },
  subscribeSpeakersPublic: () => () => {},
}));

const CONTENT_STREAMS = {
  siteContent: 'cmsContent', getBlock: 'cmsContent', getSectionBlocks: 'cmsContent',
  pages: 'cmsPages', getPage: 'cmsPages', getPublicPage: 'cmsPages',
  updates: 'cmsUpdates', scheduleData: 'cmsSchedule', speakers: 'speakers_public',
  organizationsData: 'cmsOrganizations', timeline: 'cmsTimeline',
};
const speaker = speakers.find((candidate) => scheduleData.some((session) => session.speakerIds?.includes(candidate.id)));
const session = scheduleData.find((candidate) => candidate.speakerIds?.includes(speaker.id));
const user = { uid: 'route-reader', email: 'reader@example.test', emailVerified: true, getIdToken: async () => 'synthetic-route-token' };
const profile = {
  displayName: 'Route reader', speakerId: speaker.id, profileVisibility: 'public',
  registrationStatus: 'approved', badges: [], customBadges: [],
};

function referencePath(reference) {
  const path = reference.path ?? reference.ref?.path;
  return Array.isArray(path) ? path.join('/') : path;
}

function documentSnapshot(data, id = user.uid) {
  return { id, exists: () => data !== null, data: () => data, metadata: { fromCache: false } };
}

function RecordingContexts({ reads, missing, children }) {
  const content = useContent();
  const config = useEventConfig();
  const { pathname, search } = useLocation();
  const allowed = new Set(publicSubscriptionsForRoute(pathname, search));
  function record(stream) {
    reads.add(stream);
    if (!allowed.has(stream)) missing.add(`${pathname}: ${stream}`);
  }
  const contentValue = new Proxy(content, {
    get(target, key) {
      if (CONTENT_STREAMS[key]) record(CONTENT_STREAMS[key]);
      return Reflect.get(target, key);
    },
  });
  const configValue = new Proxy(config, {
    get(target, key) {
      if (key === 'badges') record('badges');
      return Reflect.get(target, key);
    },
  });
  return (
    <EventConfigContext.Provider value={configValue}>
      <ContentContext.Provider value={contentValue}>{children}</ContentContext.Provider>
    </EventConfigContext.Provider>
  );
}

function routeUrl(path) {
  return path.replace(':sessionId', session.id).replace(':slug', path.startsWith('/sponsors') ? organizations[0].id : speaker.slug)
    .replace(':uid', user.uid).replace(':postId', 'example-post').replace(':id', 'example-update')
    .replace('/:stepSlug?', '').replace('/*', '');
}

beforeEach(() => {
  configDocs.event = { ...eventConfig, historicalDemo: false };
  configDocs.features = { ...Object.fromEntries(Object.keys(features).map((key) => [key, true])), webmcpPublic: false, webmcpAdmin: false, liveUpdates: false };
  configDocs.badges = { categories: [], customBadgeBlockList: [] };
  configDocs.launch = { comingSoon: false };
  // The historical snapshot omits history. A valid live page can add it,
  // so exercise that conditional collection consumer too.
  contentDocs.cmsPages = pages.map((page) => page.id === 'home'
    ? { ...page, sections: [...page.sections, { id: 'history', label: 'Past editions', allowedBlocks: [], defaultBlocks: [] }] }
    : page);
  contentDocs.cmsTimeline = [{ id: 'past-fixture', year: 2025, title: 'Earlier fixture event', visible: true }];
  // Populate the real bookmark/share/profile consumers at the SDK boundary,
  // so their nested SessionCards and badge controls actually render.
  vi.mocked(onSnapshot).mockImplementation((reference, options, next) => {
    const callback = typeof options === 'function' ? options : next;
    const path = referencePath(reference);
    if (path === `users/${user.uid}/bookmarks`) callback({ docs: [documentSnapshot({}, session.id)] });
    else if (path === `schedule_shares/${user.uid}`) callback(documentSnapshot({ scheduleVisibility: 'public', sessionIds: [session.id], displayName: profile.displayName }));
    else if (path === 'users_public') callback({ docs: [documentSnapshot(profile)] });
    else callback({ ...documentSnapshot(null), docs: [], size: 0, empty: true });
    return () => {};
  });
  vi.mocked(getDoc).mockImplementation(async (reference) => documentSnapshot(referencePath(reference) === `users_public/${user.uid}` ? profile : null));
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  // Only the owner read needs a populated response to reach the co-speaker
  // tab. Other network requests fail safely; this is a content-read contract.
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('/getOwnSpeakerProfile')) {
      return { ok: true, json: async () => ({ speaker: { ...speaker, status: 'approved' } }) };
    }
    return { ok: false, status: 503, json: async () => ({ error: { code: 'unavailable', message: 'Synthetic service unavailable.' } }) };
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('route content-read contract', () => {
  it.each(PUBLIC_SUBSCRIPTION_ROUTES.map(({ path }) => [path]))('%s gives its actual consumers every stream they read', async (path) => {
    const route = path === '/admin/*' ? adminRoute : publicRoutes.find((candidate) => `/${candidate.path}` === path);
    await route?.prefetch();
    const reads = new Set();
    const missing = new Set();
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[routeUrl(path)]}>
          <EventConfigProvider>
            <ContentProvider>
              <AuthContext.Provider value={{ user, loading: false, isAdmin: path === '/admin/*', adminStatus: path === '/admin/*' ? 'admin' : 'denied', adminTier: 'operator' }}>
                <ProfileContext.Provider value={{ profile, status: 'ready', attendeeAccess: true, needsProfileSetup: false, profileConfirmed: true }}>
                  <RecordingContexts reads={reads} missing={missing}>
                    <ToastProvider><AppRoutes /></ToastProvider>
                  </RecordingContexts>
                </ProfileContext.Provider>
              </AuthContext.Provider>
            </ContentProvider>
          </EventConfigProvider>
        </MemoryRouter>,
      );
    });
    if (path === '/speaker/dashboard') {
      expect(await screen.findByRole('heading', { name: 'Speaker dashboard', exact: true })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('tab', { name: 'Co-speakers' }));
      expect(reads.has('speakers_public')).toBe(true);
    }
    if (['/schedule/mine', '/schedule/user/:uid'].includes(path)) {
      expect(await screen.findByRole('link', { name: session.title, exact: true })).toBeInTheDocument();
      expect(reads.has('speakers_public')).toBe(true);
    }
    if (['/profile', '/dashboard', '/attendees', '/attendees/:uid'].includes(path)) expect(reads.has('badges')).toBe(true);
    if (path === '/specimen') expect(reads.has('speakers_public')).toBe(true);
    if (path === '/') {
      expect(screen.getByRole('heading', { name: 'Past editions', exact: true })).toBeInTheDocument();
      expect(reads.has('cmsTimeline')).toBe(true);
      expect(reads.has('cmsOrganizations')).toBe(true);
    }
    expect(screen.queryByText('This page could not be shown')).not.toBeInTheDocument();
    expect([...missing]).toEqual([]);
    // The admin overview reads config only; its all-stream policy is tested
    // separately. Every public page also reads the shared content shell.
    if (path !== '/admin/*') expect(reads.size).toBeGreaterThan(0);
  });
});
