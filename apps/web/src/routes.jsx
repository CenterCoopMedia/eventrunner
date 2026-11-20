import { routePage } from './lib/routePage.jsx';
import { loadSpecimenPage, SPECIMEN_PATH } from './pages/specimen/specimenRoute.js';
import { loadPresetRemaps } from './lib/presetRemaps.js';

function pageRoute(path, importer, chunkName, label, shape) {
  return Object.assign(routePage(importer, { chunkName }), { path, label, shape });
}

// The admin brings its own shell and access gate. Theme remaps are code,
// loaded alongside the editor rather than with the public first paint.
export const adminRoute = Object.assign(routePage(
  () => Promise.all([import('./admin/AdminApp.jsx'), loadPresetRemaps()]).then(([module]) => module),
  { clearReloadOnLoad: false, chunkName: 'AdminApp' },
), { path: 'admin/*' });

// Route rendering and intent matching use these same paths and importers.
// Reserved paths (speaker, ticket, profile, schedule) also receive links
// from email and must take precedence over the CMS catch-all.
export const publicRoutes = [
  pageRoute('schedule', () => import('./pages/Schedule.jsx'), 'Schedule', 'schedule', 'schedule'),
  pageRoute('schedule/mine', () => import('./pages/MySchedule.jsx'), 'MySchedule', 'your schedule', 'schedule'),
  pageRoute('schedule/user/:uid', () => import('./pages/SharedSchedule.jsx'), 'SharedSchedule', 'shared schedule', 'schedule'),
  pageRoute('schedule/:sessionId', () => import('./pages/SessionDetail.jsx'), 'SessionDetail', 'session'),
  pageRoute('speakers', () => import('./pages/Speakers.jsx'), 'Speakers', 'speakers', 'directory'),
  pageRoute('speakers/:slug', () => import('./pages/SpeakerDetail.jsx'), 'SpeakerDetail', 'speaker'),
  pageRoute('sponsors', () => import('./pages/Sponsors.jsx'), 'Sponsors', 'sponsors', 'directory'),
  pageRoute('sponsors/:slug', () => import('./pages/SponsorDetail.jsx'), 'SponsorDetail', 'sponsor'),
  pageRoute('updates', () => import('./pages/Updates.jsx'), 'Updates', 'updates'),
  pageRoute('updates/:id', () => import('./pages/UpdateDetail.jsx'), 'UpdateDetail', 'update'),
  pageRoute('pitch/:stepSlug?', () => import('./pages/SessionPitch.jsx'), 'SessionPitch', 'session pitch'),
  pageRoute('signin', () => import('./pages/Login.jsx'), 'Login', 'sign in'),
  pageRoute('speaker/accept', () => import('./pages/SpeakerAccept.jsx'), 'SpeakerAccept', 'speaker invitation'),
  pageRoute('speaker/profile/:stepSlug?', () => import('./pages/SpeakerProfile.jsx'), 'SpeakerProfile', 'speaker profile'),
  pageRoute('speaker/dashboard', () => import('./pages/SpeakerDashboard.jsx'), 'SpeakerDashboard', 'speaker dashboard'),
  pageRoute('ticket/claim', () => import('./pages/TicketClaim.jsx'), 'TicketClaim', 'ticket claim'),
  pageRoute('tickets', () => import('./pages/Tickets.jsx'), 'Tickets', 'tickets'),
  pageRoute('tickets/status', () => import('./pages/TicketStatus.jsx'), 'TicketStatus', 'order status'),
  pageRoute('tickets/mine', () => import('./pages/MyTickets.jsx'), 'MyTickets', 'your tickets'),
  pageRoute('registration/:stepSlug?', () => import('./pages/CompleteRegistration.jsx'), 'CompleteRegistration', 'your registration'),
  pageRoute('profile', () => import('./pages/Profile.jsx'), 'Profile', 'profile'),
  pageRoute('profile/change-requests', () => import('./pages/MyChangeRequests.jsx'), 'MyChangeRequests', 'your change requests'),
  pageRoute('profile/organization', () => import('./pages/OrganizationProfile.jsx'), 'OrganizationProfile', 'your organization'),
  pageRoute('dashboard', () => import('./pages/Dashboard.jsx'), 'Dashboard', 'dashboard'),
  pageRoute('attendees', () => import('./pages/Attendees.jsx'), 'Attendees', 'attendees', 'directory'),
  pageRoute('attendees/:uid', () => import('./pages/AttendeeProfile.jsx'), 'AttendeeProfile', 'attendee'),
  pageRoute('attendees/posts/:postId', () => import('./pages/AttendeeThread.jsx'), 'AttendeeThread', 'thread'),
  ...(loadSpecimenPage ? [pageRoute(SPECIMEN_PATH, loadSpecimenPage, 'SpecimenBook', 'specimen book')] : []),
  pageRoute('*', () => import('./pages/ContentPage.jsx'), 'ContentPage', 'page'),
];

export const prefetchRoutes = [{ path: '/' }, adminRoute, ...publicRoutes];
