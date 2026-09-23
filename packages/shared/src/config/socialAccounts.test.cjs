'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { listSocialAccounts } = require('./socialAccounts.cjs');
const { MAX_SOCIAL_LABEL_LENGTH } = require('./schema.cjs');

test('lists safe accounts with the canonical link and drops the rest', () => {
  assert.deepEqual(
    listSocialAccounts({
      handles: [
        { platform: ' Mastodon ', handle: ' @eventname ', url: 'https://EXAMPLE.org/@eventname' },
        { platform: 'Script', url: 'javascript:alert(1)' },
        { platform: 'Relative', url: 'https:example.org/@eventname' },
        { platform: '  ', url: 'https://example.org/blank' },
        { platform: 'Video', url: 'http://example.org/channel', handle: 7 },
        { platform: 3, url: 'https://example.org/number' },
        null,
        'Mastodon',
      ],
    }),
    [
      { platform: 'Mastodon', handle: '@eventname', url: 'https://example.org/@eventname' },
      { platform: 'Video', handle: '', url: 'http://example.org/channel' },
    ],
  );
});

test('cuts a stored name and handle to the schema cap', () => {
  const long = 'L'.repeat(MAX_SOCIAL_LABEL_LENGTH + 20);
  const [account] = listSocialAccounts({
    handles: [{ platform: long, handle: long, url: 'https://example.org/long' }],
  });
  assert.equal(account.platform, 'L'.repeat(MAX_SOCIAL_LABEL_LENGTH));
  assert.equal(account.handle, 'L'.repeat(MAX_SOCIAL_LABEL_LENGTH));
});

test('lists one service and link once, after trimming and canonical form', () => {
  const accounts = listSocialAccounts({
    handles: [
      { platform: 'Mastodon', url: 'https://example.org/@eventname' },
      { platform: ' Mastodon ', url: 'https://EXAMPLE.org/@eventname' },
      { platform: 'Mastodon', url: 'https://example.org/@other' },
    ],
  });
  assert.deepEqual(
    accounts.map((account) => account.url),
    ['https://example.org/@eventname', 'https://example.org/@other'],
  );
});

test('an absent or malformed block lists nothing', () => {
  for (const social of [undefined, null, {}, { handles: 'nope' }, { handles: {} }]) {
    assert.deepEqual(listSocialAccounts(social), []);
  }
});
