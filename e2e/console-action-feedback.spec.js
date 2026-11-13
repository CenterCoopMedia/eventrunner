// Hosted-only checks of real console pages, with long synthetic records and
// delayed HTTP outcomes. All external requests are blocked by the fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'e2e/fixtures/console-feedback');
const FIREBASE = path.join(ROOT, 'console/web/src/firebase.js');
const EVIDENCE = path.join(ROOT, 'test-results/admin-visual-evidence');
const APP_PATH = '/organizations/visual-newsroom/applications/visual-gathering';
const TEAM_PATH = '/organizations/visual-newsroom/team';
const DATE = '2026-11-01T12:00:00.000Z';
const AGREEMENT = {
  version: 3, title: 'Event hosting agreement',
  body: Array.from({ length: 14 }, (_, index) => `${index + 1}. The organization keeps control of its event content and attendee information. The hosting team maintains the service and helps the event team prepare its website. Both teams will discuss changes and give clear notice before making them.`).join('\n\n'),
};

function application() {
  return {
    id: 'visual-gathering', orgId: 'visual-newsroom', status: 'draft', myRole: 'owner', operator: true,
    canEdit: true, canAccept: true, canWithdraw: true, acceptance: null, errors: {}, ownersNeeded: 0,
    address: 'community-gathering.example.test', signups: { open: true },
    progress: { organization: true, event: true, webAddress: true, team: true, tickets: true, email: true, review: true, agreement: false },
    answers: {
      organization: { name: 'Community Newsroom', website: 'https://newsroom.example.test', address: '1 Community Street' },
      event: { name: 'Community News Gathering', shortName: 'News Gathering', tagline: 'A gathering for local journalism',
        timezone: 'America/New_York', days: [{ date: '2027-05-01', startTime: '09:00', endTime: '17:00' }], venue: { name: 'Community Hall', address: '2 Community Street' } },
      webAddress: { name: 'community-gathering' }, tickets: { choice: 'stripe' },
      email: { senderName: 'Community Newsroom', replyTo: 'events@example.test' },
    },
    connections: { canChange: true, canDisconnect: true,
      stripe: { available: true, connected: true, displayName: 'Community Newsroom', connectedAt: DATE },
      eventbrite: { available: true, connected: false, event: null } },
    build: null,
  };
}

function team() {
  return { organization: { id: 'visual-newsroom', name: 'Community Newsroom' }, myRole: 'owner', operator: true, ownersNeeded: 0,
    members: Array.from({ length: 16 }, (_, index) => ({ uid: index === 0 ? 'visual-owner' : `visual-member-${index}`,
      email: index === 0 ? 'organizer@example.test' : `teammate-${index}@example.test`, role: index < 2 ? 'owner' : 'editor', joinedAt: DATE })),
    invites: [{ id: 'visual-invite', email: 'invited-editor@example.test', role: 'editor', expiresAt: '2026-12-01T12:00:00.000Z' }],
  };
}

function review(status = 'building') {
  return { application: { ...application(), status, revision: 2, history: [], review: null },
    organization: { name: 'Community Newsroom' }, team: { members: [], invites: [] }, connection: { label: 'Connected to Stripe' },
    canRetryBuild: status === 'building',
    build: { state: 'failed', runUrl: null, testMode: true, error: 'The final address check did not complete.',
      steps: Array.from({ length: 12 }, (_, index) => ({ id: `stage-${index}`, label: `Build stage ${index + 1}`, state: index === 11 ? 'failed' : 'done', at: DATE,
        detail: index === 11 ? 'The address still needs a final check.' : 'This stage completed successfully and will not be repeated.' })) },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const failure = (message, code = 'unavailable', field) => ({ status: 503, json: { error: { code, message, ...(field ? { field } : {}) } } });
let server;
let origin;

test.beforeAll(async () => {
  const { createServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  // configFile is off, so reuse the console's prebundle list (see console-workspace.spec.js).
  const { default: consoleConfig } = await import('../console/web/vite.config.js');
  server = await createServer({ configFile: false, root: FIXTURE, optimizeDeps: consoleConfig.optimizeDeps,
    plugins: [{ name: 'console-feedback-fixture', enforce: 'pre', resolveId(source, importer) {
      if (importer && source.startsWith('.') && path.resolve(path.dirname(importer.split('?')[0]), source) === FIREBASE) return path.join(FIXTURE, 'firebase.js');
      return null;
    } }, react()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } },
    define: { 'import.meta.env.VITE_CONSOLE_API_BASE': JSON.stringify(''),
      'import.meta.env.VITE_CONSOLE_HELP_EMAIL': JSON.stringify('support@example.test'),
      'import.meta.env.VITE_CONSOLE_HELP_NAME': JSON.stringify('the hosting team') },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await fs.mkdir(EVIDENCE, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function intercept(page, handler) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const action = url.pathname.split('/').at(-1);
    const response = await handler(action, route.request().postDataJSON());
    expect(response, `Unexpected console action: ${action}`).toBeDefined();
    await route.fulfill(response.status ? response : { json: response });
  });
  return errors;
}

async function capture(page, name, width) {
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
  await page.screenshot({ path: path.join(EVIDENCE, `console-feedback-${name}-${width}.png`) });
}

for (const width of [1440, 390, 320]) {
  test(`agreement feedback stays beside Accept on a long page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.emulateMedia({ colorScheme: width === 320 ? 'dark' : 'light', reducedMotion: 'reduce' });
    const pending = deferred();
    let attempts = 0;
    const errors = await intercept(page, async (name) => {
      if (name === 'getApplication') return { application: application() };
      if (name === 'getAgreement') return { agreement: AGREEMENT, accepted: null };
      if (name === 'acceptAgreement') { attempts += 1; await pending.promise; return failure('The agreement could not be accepted. Try again.'); }
    });
    await page.goto(`${origin}${APP_PATH}/agreement`);
    await page.getByLabel("Your organization's legal name").fill('Community Newsroom Association');
    await page.getByLabel('Your job title').fill('Event organizer');
    await page.getByLabel('Your full name').fill('Alex Organizer');
    await page.getByRole('button', { name: 'Accept agreement' }).click();
    await expect(page.getByRole('button', { name: 'Accepting' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Accepting' })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByLabel('Your full name')).toBeDisabled();
    pending.resolve();
    const result = page.getByRole('alert');
    await expect(result).toHaveText('The agreement could not be accepted. Try again.');
    await expect(result).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Accept agreement' })).toBeInViewport();
    await expect(page.getByLabel('Your full name')).toHaveValue('Alex Organizer');
    await capture(page, 'agreement-error', width);
    expect(attempts).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`team invitation and read recovery stay at the bottom action at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.emulateMedia({ colorScheme: width === 320 ? 'dark' : 'light', reducedMotion: 'reduce' });
    const pending = deferred();
    let invites = 0;
    let reads = 0;
    const errors = await intercept(page, async (name) => {
      if (name === 'getTeam') { reads += 1; return reads === 2 ? failure('The team list could not be refreshed.') : team(); }
      if (name === 'inviteMember') {
        invites += 1;
        if (invites === 1) { await pending.promise; return failure('We could not send this invite. Try again.'); }
        return { invite: { id: 'visual-new-invite' } };
      }
    });
    await page.goto(`${origin}${TEAM_PATH}`);
    await page.getByLabel('Email address').fill('new-editor@example.test');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByRole('button', { name: 'Sending invite…' })).toBeDisabled();
    await expect(page.getByLabel('Email address')).toBeDisabled();
    pending.resolve();
    await expect(page.getByRole('alert')).toHaveText('We could not send this invite. Try again.');
    await expect(page.getByRole('alert')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeInViewport();
    await expect(page.getByLabel('Email address')).toHaveValue('new-editor@example.test');
    await capture(page, 'invite-error', width);
    await page.getByRole('button', { name: 'Send invite' }).click();
    const refresh = page.getByRole('button', { name: 'Refresh team' });
    await expect(refresh).toBeInViewport();
    await expect(page.getByRole('status')).toContainText('We sent an invite to new-editor@example.test.');
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeDisabled();
    await capture(page, 'team-refresh', width);
    await refresh.click();
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeEnabled();
    expect(invites).toBe(2);
    expect(reads).toBe(3);
    expect(errors).toEqual([]);
  });

  test(`hosting decision recovery is visible without resubmitting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.emulateMedia({ colorScheme: width === 320 ? 'dark' : 'light', reducedMotion: 'reduce' });
    const pending = deferred();
    let decisions = 0;
    let reads = 0;
    const errors = await intercept(page, async (name) => {
      if (name === 'getApplicationForReview') { reads += 1; return reads === 2 ? failure('The current request could not be refreshed.') : review(reads > 2 ? 'declined' : 'building'); }
      if (name === 'closeApplication') { decisions += 1; await pending.promise; return { emailed: 2, mailFailed: false }; }
    });
    await page.goto(`${origin}/review/visual-gathering`);
    await page.getByRole('button', { name: 'Close request' }).click();
    await page.getByLabel('Note to the client').fill('This request was replaced by a new event.');
    await page.getByRole('form', { name: 'Close this request' }).getByRole('button', { name: 'Close request' }).click();
    await expect(page.getByRole('button', { name: 'Saving decision…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    pending.resolve();
    const result = page.getByRole('status');
    await expect(result).toContainText('The decision is saved, but we could not refresh the request.');
    await expect(result).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Refresh request after action', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Close request' })).toBeDisabled();
    await capture(page, 'decision-refresh', width);
    await page.getByRole('button', { name: 'Refresh request after action', exact: true }).click();
    // The page heading keeps its own Refresh request button.
    await expect(page.getByRole('button', { name: 'Refresh request' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Refresh request after action', exact: true })).toHaveCount(0);
    expect(decisions).toBe(1);
    expect(reads).toBe(3);
    expect(errors).toEqual([]);
  });
}

test('console waiting stages remain readable and current-step focus stays distinct at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  // Install before application timers exist, let the first page load and
  // open the folded steps, then pause before navigating to the held read.
  // Only elapsed time is simulated.
  await page.clock.install({ time: new Date('2026-11-01T12:00:00.000Z') });
  const pending = deferred();
  let reads = 0;
  const errors = await intercept(page, async (name) => {
    if (name === 'getApplication') return { application: application() };
    if (name === 'getTeam') { reads += 1; if (reads === 1) await pending.promise; return team(); }
  });

  try {
    await page.goto(`${origin}${APP_PATH}/organization`);
    await expect(page.getByLabel('Website (optional)')).toBeVisible();
    const steps = page.getByRole('navigation', { name: 'Setup steps' });
    await steps.getByText('Show all 8 steps', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.clock.pauseAt(new Date('2026-11-01T12:10:00.000Z'));
    const teamLink = steps.getByRole('link', { name: /Your team/ });
    // Keyboard activation does not require animation-frame stability while
    // the application clock is paused, and exercises the actual step link.
    await teamLink.focus();
    await page.keyboard.press('Enter');

    const loading = page.getByRole('status').filter({ hasText: 'Loading the team.' });
    const indicator = loading.locator('.console-loading-indicator');
    const spinner = loading.locator('.console-spinner');
    await expect(loading).toHaveText('Loading the team.');
    await expect(loading).toHaveAttribute('data-loading-stage', 'initial');
    await expect(loading).toHaveAttribute('aria-atomic', 'true');
    await expect(indicator).toHaveAttribute('aria-hidden', 'true');
    await expect(indicator).toBeHidden();
    await expect.poll(() => reads).toBe(1);
    await page.clock.fastForward(999);
    await expect(loading).toHaveAttribute('data-loading-stage', 'initial');
    await expect(spinner).toBeHidden();
    await page.clock.fastForward(1);
    await expect(loading).toHaveAttribute('data-loading-stage', 'active');
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveCSS('animation-name', 'console-spin');
    await expect(loading).toHaveText('Loading the team.');

    await page.clock.fastForward(9000);
    await expect(loading).toHaveAttribute('data-loading-stage', 'slow');
    await expect(loading).toContainText('This is taking longer than expected.');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await expect(spinner).toHaveCSS('transform', 'none');
    await capture(page, 'waiting-slow-reduced-motion', 390);

    // The read deadline arrives before LoadingState's 60 s extended stage.
    // Keep the long-wait message through the last millisecond, then recover.
    await page.clock.fastForward(19999);
    await expect(loading).toHaveAttribute('data-loading-stage', 'slow');
    await expect(loading).toContainText('This is taking longer than expected.');
    await expect(loading.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    expect(reads).toBe(1);

    await page.clock.fastForward(1);
    const timeout = page.getByRole('alert');
    await expect(timeout).toContainText('We could not finish loading. Try again.');
    const reload = timeout.getByRole('button', { name: 'Reload team' });
    await expect(reload).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.console-spinner')).toHaveCount(0);
    expect(reads).toBe(1);
    await capture(page, 'waiting-timeout-reduced-motion', 390);

    pending.resolve();
    await reload.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Invite the people who run the event with you.', { exact: true })).toBeVisible();
    await expect(timeout).toHaveCount(0);
    await expect(loading).toHaveCount(0);
    await expect(page.locator('.console-spinner')).toHaveCount(0);
    expect(reads).toBe(2);

    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.getByRole('heading', { name: 'Your team', exact: true }).focus();
    // A completed step move closes the narrow list. Open it before testing
    // the selected link's keyboard focus, as a reader does.
    await steps.getByText('Show all 8 steps', { exact: true }).focus();
    await page.keyboard.press('Enter');
    const current = steps.locator('a[aria-current="step"]');
    await expect(current).toHaveAttribute('href', `${APP_PATH}/team`);
    const selectedOffset = await current.evaluate((element) => Number.parseFloat(globalThis.getComputedStyle(element).outlineOffset));
    expect(selectedOffset).toBeLessThan(0);
    await current.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(current).toBeFocused();
    const focus = await current.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return { visible: element.matches(':focus-visible'), style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth), offset: Number.parseFloat(style.outlineOffset) };
    });
    expect(focus.visible).toBe(true);
    expect(focus.style).toBe('solid');
    expect(focus.width).toBeGreaterThan(0);
    expect(focus.offset).toBeGreaterThan(0);
    await capture(page, 'current-step-forced-colors-focus', 390);
    expect(errors).toEqual([]);
  } finally {
    pending.resolve();
    await page.clock.resume();
  }
});

test('setup Leave retains a failed save and retries only the waiting answers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pending = deferred();
  let saves = 0;
  const errors = await intercept(page, async (name, body) => {
    if (name === 'getApplication') return { application: application() };
    if (name === 'saveApplicationStep') {
      saves += 1;
      if (saves === 1) { await pending.promise; return failure('Your changes could not be saved.'); }
      return { ...body, saved: true, errors: {} };
    }
  });
  await page.goto(`${origin}${APP_PATH}/organization`);
  await page.getByLabel('Website (optional)').fill('https://updated.example.test');
  await page.getByRole('link', { name: 'Close setup' }).click();
  await expect(page.getByLabel('Website (optional)')).toBeDisabled();
  await expect(page).toHaveURL(`${origin}${APP_PATH}/organization`);
  pending.resolve();
  await expect(page.getByRole('alert')).toContainText('Not saved. Your changes could not be saved.');
  await expect(page.getByRole('alert')).toBeInViewport();
  await expect(page.getByLabel('Save and continue')).toBeFocused();
  await capture(page, 'setup-save', 390);
  await page.getByRole('link', { name: 'Close setup' }).click();
  await expect(page).toHaveURL(`${origin}${APP_PATH}`);
  expect(saves).toBe(2);
  expect(errors).toEqual([]);
});

test('revoke failure retains the last row confirmation on a long mobile list', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const pending = deferred();
  let revokes = 0;
  const errors = await intercept(page, async (name) => {
    if (name === 'listSignupLinks') return { links: Array.from({ length: 14 }, (_, index) => ({
      id: `visual-link-${index}`, organizationName: `Community newsroom ${index + 1}`, status: 'open', createdAt: DATE, expiresAt: '2026-12-01T12:00:00.000Z',
    })) };
    if (name === 'revokeSignupLink') { revokes += 1; await pending.promise; return failure('This signup link could not be revoked. Try again.'); }
  });
  await page.goto(`${origin}/review/links`);
  const row = page.getByRole('listitem', { name: 'Community newsroom 14' });
  await row.getByRole('button', { name: 'Revoke link for Community newsroom 14' }).click();
  await row.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  pending.resolve();
  await expect(row.getByRole('alert')).toBeInViewport();
  await expect(row.getByRole('group')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Revoke', exact: true })).toBeEnabled();
  await capture(page, 'revoke-error', 320);
  expect(revokes).toBe(1);
  expect(errors).toEqual([]);
});
