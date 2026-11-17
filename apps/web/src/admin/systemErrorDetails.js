import { isChunkLoadError } from '../lib/chunkReload.js';

// Fixed activity names keep record titles, IDs and URL parameters out of cards.
const ACTIVITIES = new Map([
  ['/admin/overview', 'viewing the event overview'],
  ['/admin/ticketing', 'managing tickets'],
  ['/admin/pages/new', 'creating a page'],
  ['/admin/versions', 'viewing version history'],
  ['/updates', 'reading live updates'],
]);

function activityFor(url) {
  if (typeof url !== 'string') return null;
  try {
    const path = new URL(url, 'https://eventrunner.invalid').pathname.replace(/\/+$/, '');
    return ACTIVITIES.get(path) ?? null;
  } catch {
    return null;
  }
}

export function systemErrorDetails(row) {
  if (row.kind === 'template-override-invalid') return {
    title: 'Email wording needs attention',
    message: 'Sign-in emails are using the default wording. Ask the Event Runner team to check your saved wording.',
  };
  if (row.kind === 'client-error') {
    const activity = activityFor(row.url);
    const message = typeof row.message === 'string' ? row.message : '';
    const pageFileFailed = isChunkLoadError({ name: 'TypeError', message });
    // A default-property error alone does not prove a missing module. Describe
    // the page error without claiming its cause or a failed payment/submission.
    const pageError = pageFileFailed || /^(?:TypeError: )?(?:Cannot read properties of undefined \(reading ['"]default['"]\)|can't access property ["']default["'], [\w$.]+ is undefined)$/.test(message);
    if (pageError) return {
      title: activity ? `Page error while ${activity}` : 'A page could not be shown',
      message: `${pageFileFailed ? 'A required page file could not be loaded.' : 'Part of the page failed in the browser.'} Reload the page. If it fails again, ask the Event Runner team to check it.`,
    };
    return {
      title: activity ? `Browser error while ${activity}` : 'A browser error occurred',
      message: 'The browser reported an error. Ask the Event Runner team to check it. The report does not confirm whether an action finished.',
    };
  }
  return {
    title: 'Site error',
    message: 'An action on the site failed. Ask the Event Runner team to check it.',
  };
}
