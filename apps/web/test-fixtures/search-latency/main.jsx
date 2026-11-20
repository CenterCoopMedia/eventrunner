// Production-build fixture for the search latency baseline (issue #1135).
// The real Schedule and Attendees pages render under the same BrowserRouter
// the application uses, with synthetic providers in place of Firebase. The
// spec build swaps the three data-source modules for ./sources (one boundary,
// no live project).
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { eventConfig as snapshotEvent, features as snapshotFeatures, theme } from '@generated/eventConfig.js';
import EventConfigContext from '../../src/contexts/EventConfigContext.jsx';
import ContentContext from '../../src/contexts/ContentContext.jsx';
import AuthContext from '../../src/contexts/AuthContext.jsx';
import ProfileContext from '../../src/contexts/ProfileContext.jsx';
import Schedule from '../../src/pages/Schedule.jsx';
import Attendees from '../../src/pages/Attendees.jsx';
import { eventDays, eventTracks, fixture } from './data.js';
import '@generated/theme.css';
import '../../src/index.css';
import '../../src/styles/schedule.css';

const eventConfig = {
  ...snapshotEvent,
  name: 'Synthetic latency fixture',
  shortName: 'Fixture',
  timezone: 'America/New_York',
  days: eventDays,
  tracks: eventTracks,
  contentLanguages: undefined,
  historicalDemo: false,
};
const features = {
  ...snapshotFeatures,
  schedule: true,
  attendeeDirectory: true,
  publicAttendeeProfiles: true,
  sessionBookmarks: true,
  socialFeed: false,
  icsExport: false,
  schedulePdf: false,
};
const snapshot = { event: 'snapshot', features: 'snapshot', theme: 'snapshot', badges: 'snapshot' };
const config = {
  eventConfig, features, theme, badges: null, source: 'snapshot', sources: snapshot, featuresStatus: 'snapshot',
  available: { event: false, features: false, theme: false, badges: false }, setDemoTheme: null,
};
const none = () => null;
const content = {
  readSource: 'published', source: 'snapshot', contentSource: 'snapshot', languageRecordsReady: false,
  siteContent: {}, pages: [], updates: [], scheduleData: fixture.scheduleData, speakers: fixture.speakers,
  organizationsData: [], timeline: [], loading: false,
  getBlock: none, getSectionBlocks: () => [], getPage: none, getPublicPage: none,
};
const auth = { user: { uid: 'synthetic-reader' }, isAdmin: false, isOperator: false, loading: false, authError: null };
const profile = {
  uid: 'synthetic-reader',
  profile: { displayName: 'Synthetic reader', profileVisibility: 'public', role: 'attendee', status: 'approved' },
  status: 'ready', attendeeAccess: true, needsProfileSetup: false, profileConfirmed: true, profileReady: true,
  saveProfile: () => Promise.resolve(),
};

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <EventConfigContext.Provider value={config}>
      <ContentContext.Provider value={content}>
        <AuthContext.Provider value={auth}>
          <ProfileContext.Provider value={profile}>
            {/* The top-navigation content frame from components/Layout.jsx. */}
            <main id="main-content" tabIndex={-1} className="stage flex-1 pb-2xl pt-xl">
              <Routes>
                <Route path="schedule" element={<Schedule />} />
                <Route path="attendees" element={<Attendees />} />
              </Routes>
            </main>
          </ProfileContext.Provider>
        </AuthContext.Provider>
      </ContentContext.Provider>
    </EventConfigContext.Provider>
  </BrowserRouter>,
);
