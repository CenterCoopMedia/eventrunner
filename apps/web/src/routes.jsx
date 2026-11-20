import { routePage } from './lib/routePage.jsx';
import { loadSpecimenPage, SPECIMEN_PATH } from './pages/specimen/specimenRoute.js';
import { loadPresetRemaps } from './lib/presetRemaps.js';

function pageRoute(path, importer, label, chunkName, shape) {
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
  pageRoute('schedule', () => import('./pages/Schedule.jsx'), 'schedule', 'Schedule', 'schedule'),
  pageRoute('schedule/mine', () => import('./pages/MySchedule.jsx'), 'your schedule', 'MySchedule', 'schedule'),
  pageRoute('schedule/user/:uid', () => import('./pages/SharedSchedule.jsx'), 'shared schedule', 'SharedSchedule', 'schedule'),
  pageRoute('schedule/:sessionId', () => import('./pages/SessionDetail.jsx'), 'session', 'SessionDetail'),
  pageRoute('speakers', () => import('./pages/Speakers.jsx'), 'speakers', 'Speakers', 'directory'),
  pageRoute('speakers/:slug', () => import('./pages/SpeakerDetail.jsx'), 'speaker', 'SpeakerDetail'),
  pageRoute('sponsors', () => import('./pages/Sponsors.jsx'), 'sponsors', 'Sponsors', 'directory'),
  pageRoute('sponsors/:slug', () => import('./pages/SponsorDetail.jsx'), 'sponsor', 'SponsorDetail'),
  pageRoute('updates', () => import('./pages/Updates.jsx'), 'updates', 'Updates'),
  pageRoute('updates/:id', () => import('./pages/UpdateDetail.jsx'), 'update', 'UpdateDetail'),
  pageRoute('pitch/:stepSlug?', () => import('./pages/SessionPitch.jsx'), 'session pitch', 'SessionPitch'),
  pageRoute('signin', () => import('./pages/Login.jsx'), 'sign in', 'Login'),
  pageRoute('speaker/accept', () => import('./pages/SpeakerAccept.jsx'), 'speaker invitation', 'SpeakerAccept'),
  pageRoute('speaker/profile/:stepSlug?', () => import('./pages/SpeakerProfile.jsx'), 'speaker profile', 'SpeakerProfile'),
  pageRoute('speaker/dashboard', () => import('./pages/SpeakerDashboard.jsx'), 'speaker dashboard', 'SpeakerDashboard'),
  pageRoute('ticket/claim', () => import('./pages/TicketClaim.jsx'), 'ticket claim', 'TicketClaim'),
  pageRoute('tickets', () => import('./pages/Tickets.jsx'), 'tickets', 'Tickets'),
  pageRoute('tickets/status', () => import('./pages/TicketStatus.jsx'), 'order status', 'TicketStatus'),
  pageRoute('tickets/mine', () => import('./pages/MyTickets.jsx'), 'your tickets', 'MyTickets'),
  pageRoute('registration/:stepSlug?', () => import('./pages/CompleteRegistration.jsx'), 'your registration', 'CompleteRegistration'),
  pageRoute('profile', () => import('./pages/Profile.jsx'), 'profile', 'Profile'),
  pageRoute('profile/change-requests', () => import('./pages/MyChangeRequests.jsx'), 'your change requests', 'MyChangeRequests'),
  pageRoute('profile/organization', () => import('./pages/OrganizationProfile.jsx'), 'your organization', 'OrganizationProfile'),
  pageRoute('dashboard', () => import('./pages/Dashboard.jsx'), 'dashboard', 'Dashboard'),
  pageRoute('attendees', () => import('./pages/Attendees.jsx'), 'attendees', 'Attendees', 'directory'),
  pageRoute('attendees/:uid', () => import('./pages/AttendeeProfile.jsx'), 'attendee', 'AttendeeProfile'),
  pageRoute('attendees/posts/:postId', () => import('./pages/AttendeeThread.jsx'), 'thread', 'AttendeeThread'),
  ...(loadSpecimenPage ? [pageRoute(SPECIMEN_PATH, loadSpecimenPage, 'specimen book')] : []),
  pageRoute('*', () => import('./pages/ContentPage.jsx'), 'page', 'ContentPage'),
];

export const prefetchRoutes = [{ path: '/' }, adminRoute, ...publicRoutes];
