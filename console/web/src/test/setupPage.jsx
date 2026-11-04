import Setup from '../pages/setup/Setup.jsx';
import { renderPage } from './renderPage.jsx';

/** Render the guided setup at one step, with stand-in pages for where it can send the reader. */
export function renderSetup(step, { query = '', auth } = {}) {
  return renderPage(<Setup />, {
    path: `/organizations/o1/applications/a1/${step}${query}`,
    route: '/organizations/:orgId/applications/:appId/:step',
    auth,
    routes: { '/organizations/:orgId/applications/:appId': 'Status page' },
  });
}
