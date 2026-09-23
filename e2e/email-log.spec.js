// The outbound email log (issue #183), on the real surface.
//
// The done line crosses the send path, the store and the page, so only the
// emulators prove it: the seeded operator signs in through the real sign-in
// page, which sends a code email through the console provider and writes a
// sent_emails row, and the email log page then finds that row by the
// operator's own address. The preview half seeds one stored body that tries
// to run script and to load a remote image, opens it in the real sandboxed
// frame, and watches every request the page and its frames make.
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const PROBE_TO = 'preview-probe@example.test';
const PIXEL_HOST = 'pixel.example.test';
const NON_ADMIN_EMAIL = 'email-log-viewer@example.test';

const searchField = (page) => page.getByRole('searchbox', { name: 'Search recipient or subject' });

async function search(page, text) {
  await searchField(page).fill(text);
  const button = page.getByRole('button', { name: 'Search', exact: true });
  await button.click();
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
}

test.describe.serial('the email log', () => {
  let probeRef;

  test.afterAll(async () => {
    if (probeRef) await probeRef.delete();
  });

  test('a sent code email appears in the log, with its body not stored', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/email-log');
    await expect(page.getByRole('heading', { level: 1, name: 'Email log' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Email log', exact: true })).toHaveAttribute('aria-current', 'page');

    await search(page, ADMIN_EMAIL);
    const row = page.getByRole('row').filter({ hasText: ADMIN_EMAIL }).filter({ hasText: 'Sign-in code' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Not stored');
    await expect(page.getByRole('status').filter({ hasText: /match(es)? in the/ })).toBeVisible();

    // The searched address never enters the URL.
    expect(page.url()).not.toContain('e2e-admin');
    expect(decodeURIComponent(page.url())).not.toContain(ADMIN_EMAIL);

    // Its preview says why there is nothing to show, and draws no frame.
    await row.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByText('This message’s body was not stored because it held a sign-in code or an invitation link.')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('the preview renders a stored body with no script and no request', async ({ page }) => {
    probeRef = adminDb().collection('sent_emails').doc();
    await probeRef.set({
      to: PROBE_TO,
      from: null,
      subject: 'Preview probe',
      templateId: null,
      providerMessageId: null,
      status: 'sent',
      providerStatus: null,
      error: null,
      retries: 0,
      bodyStored: true,
      html: [
        '<p id="probe">Script did not run.</p>',
        '<script>document.getElementById("probe").textContent = "Script ran.";</script>',
        '<img src="missing.png" alt="" onerror="document.getElementById(\'probe\').textContent = \'Handler ran.\'">',
        `<img src="https://${PIXEL_HOST}/open.png" alt="">`,
        `<p><a href="https://${PIXEL_HOST}/read">Read online</a></p>`,
      ].join(''),
      text: 'Script did not run.',
      bodyTruncated: false,
      source: 'operator-notify',
      sentAt: new Date(),
    });

    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/email-log');
    await search(page, 'preview-probe');
    const row = page.getByRole('row').filter({ hasText: PROBE_TO });
    await expect(row).toContainText('Operator alert');

    // Every request from here on, from the page and from every frame in it,
    // with how it ended. Chromium reports a subresource the content policy
    // refuses as a request that fails with the reason "csp" before it leaves
    // the renderer; a request that left would end in a response or in a
    // network error (this host does not resolve).
    const network = [];
    page.on('request', (request) => network.push({ kind: 'request', method: request.method(), url: request.url() }));
    page.on('requestfailed', (request) => network.push({ kind: 'failed', url: request.url(), reason: request.failure()?.errorText }));
    page.on('response', (response) => network.push({ kind: 'response', url: response.url() }));
    const consoleLines = [];
    page.on('console', (message) => consoleLines.push(message.text()));

    // The button names its next action, so it is found by both of its names.
    const preview = row.getByRole('button', { name: /^(Preview|Hide preview)$/ });
    await expect(preview).toHaveText('Preview');
    await preview.click();
    await expect(preview).toHaveText('Hide preview');
    await expect(preview).toHaveAttribute('aria-expanded', 'true');
    await expect(preview).toBeFocused();

    const frameElement = page.locator(`iframe[title="Message to ${PROBE_TO}"]`);
    await expect(frameElement).toBeVisible();
    expect(await frameElement.getAttribute('sandbox')).toBe('');
    expect(await frameElement.getAttribute('referrerpolicy')).toBe('no-referrer');
    const srcdoc = await frameElement.getAttribute('srcdoc');
    expect(srcdoc).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'">',
    );

    // The body rendered, and neither the script nor the handler changed it.
    const frame = page.frameLocator(`iframe[title="Message to ${PROBE_TO}"]`);
    await expect(frame.locator('#probe')).toHaveText('Script did not run.');
    // A click on the link goes nowhere: the sandbox refuses the new tab, and
    // the frame stays on the message.
    const popup = page.context().waitForEvent('page', { timeout: 2000 }).then(() => true, () => false);
    await frame.getByRole('link', { name: 'Read online' }).click();
    expect(await popup).toBe(false);
    await expect(frame.locator('#probe')).toHaveText('Script did not run.');
    expect(page.url()).toContain('/admin/email-log');
    expect(page.context().pages()).toHaveLength(1);

    // Opening the preview asked the server for the message and nothing else
    // left the browser: both images were refused by the policy, the link
    // raised no request at all, and nothing from the frame got a response.
    const fromBody = (entry) => entry.url.includes(PIXEL_HOST) || entry.url.includes('missing.png');
    const raised = () => network.filter((entry) => fromBody(entry) && entry.kind === 'request');
    const refused = () => network.filter((entry) => fromBody(entry) && entry.kind === 'failed');
    await expect.poll(() => refused().length).toBe(raised().length);
    expect(refused().map((entry) => entry.reason)).toEqual(raised().map(() => 'csp'));
    expect(network.filter((entry) => fromBody(entry) && entry.kind === 'response')).toEqual([]);
    expect(network.filter((entry) => entry.url.endsWith('/read'))).toEqual([]);
    expect(network.filter(({ kind, method, url }) => kind === 'request' && method === 'POST' && /\/getSentEmail$/.test(url))).toHaveLength(1);
    // Chromium says why: the sandbox refused the script and the handler, the
    // policy refused the images, and the sandbox refused the new tab.
    const said = consoleLines.join('\n');
    expect(said).toContain("Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed");
    expect(said).toContain(`Refused to load the image 'https://${PIXEL_HOST}/open.png'`);
    expect(said).toContain(`Blocked opening 'https://${PIXEL_HOST}/read' in a new window`);

    // The read is on the record, by path and actor only.
    const logs = await adminDb().collection('admin_logs')
      .where('docPath', '==', `sent_emails/${probeRef.id}`).get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()).toMatchObject({ action: 'view-sent-email', email: ADMIN_EMAIL });
    expect(JSON.stringify(logs.docs[0].data())).not.toContain(PROBE_TO);
  });

  test('the endpoint refuses a caller with no token and a signed-in non-admin', async () => {
    const anonymous = await callFunction('listSentEmails', {});
    expect(anonymous.status).toBe(401);

    const token = await idTokenFor(await ensureUser(NON_ADMIN_EMAIL));
    const listed = await callFunction('listSentEmails', {}, token);
    expect(listed.status).toBe(403);
    const fetched = await callFunction('getSentEmail', { id: probeRef?.id ?? 'missing' }, token);
    expect(fetched.status).toBe(403);
  });
});
