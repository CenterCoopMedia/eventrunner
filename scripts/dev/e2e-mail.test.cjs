'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('the captured OTP inbox ignores numbers in later unrelated mail', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eventrunner-otp-test-'));
  const mailFile = path.join(directory, 'mail.jsonl');
  const previous = process.env.E2E_MAIL_FILE;
  process.env.E2E_MAIL_FILE = mailFile;
  try {
    const to = 'e2e-inbox@example.test';
    await fs.writeFile(mailFile, [
      { to, tag: 'auth.otp', text: 'Your sign-in code is 135790.', html: '<p>135790</p>' },
      { to, tag: 'ticket.get_ticket', text: 'Get a ticket.', html: '<p data-reference="654321">Get a ticket.</p>' },
    ].map((mail) => JSON.stringify(mail)).join('\n') + '\n');
    const { waitForOtpCode } = await import('../../e2e/helpers.mjs');
    assert.equal(await waitForOtpCode(0, to, 1_000), '135790');
  } finally {
    if (previous === undefined) delete process.env.E2E_MAIL_FILE;
    else process.env.E2E_MAIL_FILE = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
