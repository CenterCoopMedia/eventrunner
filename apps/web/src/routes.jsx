import { routePage } from './lib/routePage.jsx';
import { loadSpecimenPage, SPECIMEN_PATH } from './pages/specimen/specimenRoute.js';
import { loadPresetRemaps } from './lib/presetRemaps.js';

function pageRoute(path, importer, label, shape) {
  return Object.assign(routePage(importer), { path, label, shape });
}

// The admin brings its own shell and access gate. Theme remaps are code,
// loaded alongside the editor rather than with the public first paint.
export const adminRoute = Object.assign(routePage(
  () => Promise.all([import('./admin/AdminApp.jsx'), loadPresetRemaps()]).then(([module]) => module),
  { clearReloadOnLoad: false },
), { path: 'admin/*' });

// Route rendering and intent matching use these same paths and importers.
// Reserved paths (speaker, ticket, profile, schedule) also receive links
// from email and must take precedence over the CMS catch-all.
export const publicRoutes = [
  pageRoute('schedule', () => import('./pages/Schedule.jsx'), 'schedule', 'schedule'),
  pageRoute('schedule/mine', () => import('./pages/MySchedule.jsx'), 'your schedule', 'schedule'),
  pageRoute('schedule/user/:uid', () => import('./pages/SharedSchedule.jsx'), 'shared schedule', 'schedule'),
  pageRoute('schedule/:sessionId', () => import('./pages/SessionDetail.jsx'), 'session'),
  pageRoute('speakers', () => import('./pages/Speakers.jsx'), 'speakers', 'directory'),
  pageRoute('speakers/:slug', () => import('./pages/SpeakerDetail.jsx'), 'speaker'),
  pageRoute('sponsors', () => import('./pages/Sponsors.jsx'), 'sponsors', 'directory'),
  pageRoute('sponsors/:slug', () => import('./pages/SponsorDetail.jsx'), 'sponsor'),
  pageRoute('updates', () => import('./pages/Updates.jsx'), 'updates'),
  pageRoute('updates/:id', () => import('./pages/UpdateDetail.jsx'), 'update'),
  pageRoute('pitch/:stepSlug?', () => import('./pages/SessionPitch.jsx'), 'session pitch'),
  pageRoute('signin', () => import('./pages/Login.jsx'), 'sign in'),
  pageRoute('speaker/accept', () => import('./pages/SpeakerAccept.jsx'), 'speaker invitation'),
  pageRoute('speaker/profile/:stepSlug?', () => import('./pages/SpeakerProfile.jsx'), 'speaker profile'),
  pageRoute('speaker/dashboard', () => import('./pages/SpeakerDashboard.jsx'), 'speaker dashboard'),
  pageRoute('ticket/claim', () => import('./pages/TicketClaim.jsx'), 'ticket claim'),
  pageRoute('tickets', () => import('./pages/Tickets.jsx'), 'tickets'),
  pageRoute('tickets/status', () => import('./pages/TicketStatus.jsx'), 'order status'),
  pageRoute('tickets/mine', () => import('./pages/MyTickets.jsx'), 'your tickets'),
  pageRoute('registration/:stepSlug?', () => import('./pages/CompleteRegistration.jsx'), 'your registration'),
  pageRoute('profile', () => import('./pages/Profile.jsx'), 'profile'),
  pageRoute('profile/change-requests', () => import('./pages/MyChangeRequests.jsx'), 'your change requests'),
  pageRoute('profile/organization', () => import('./pages/OrganizationProfile.jsx'), 'your organization'),
  pageRoute('dashboard', () => import('./pages/Dashboard.jsx'), 'dashboard'),
  pageRoute('attendees', () => import('./pages/Attendees.jsx'), 'attendees', 'directory'),
  pageRoute('attendees/:uid', () => import('./pages/AttendeeProfile.jsx'), 'attendee'),
  pageRoute('attendees/posts/:postId', () => import('./pages/AttendeeThread.jsx'), 'thread'),
  ...(loadSpecimenPage ? [pageRoute(SPECIMEN_PATH, loadSpecimenPage, 'specimen book')] : []),
  pageRoute('*', () => import('./pages/ContentPage.jsx'), 'page'),
];

export const prefetchRoutes = [{ path: '/' }, adminRoute, ...publicRoutes];
