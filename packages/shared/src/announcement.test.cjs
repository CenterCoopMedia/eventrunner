'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeAnnouncementText,
  readAnnouncement,
  activeAnnouncements,
} = require('./announcement.cjs');

test('sanitizes announcement text as bounded plain text', () => {
  assert.equal(
    sanitizeAnnouncementText('  <img src=x onerror=alert(1)> Doors\u0000 open.  '),
    'Doors open.',
  );
});

test('sanitizes a stored announcement again on read', () => {
  assert.deepEqual(readAnnouncement({
    id: 'a1',
    message: '<b>Room changed</b>',
    level: 'invented',
    startsAt: new Date(1000),
    endsAt: { toMillis: () => 3000 },
    link: { url: 'javascript:alert(1)', label: '<i>Details</i>' },
  }), {
    id: 'a1',
    message: 'Room changed',
    level: 'info',
    startsAt: 1000,
    endsAt: 3000,
    link: null,
  });
});

test('returns only active, valid announcements in newest-first order', () => {
  const records = [
    { id: 'old', message: 'Old', level: 'info', startsAt: 0, endsAt: 999 },
    { id: 'first', message: 'First', level: 'info', startsAt: 1000, endsAt: 3000 },
    { id: 'second', message: 'Second', level: 'urgent', startsAt: 1500, endsAt: 3000 },
    { id: 'future', message: 'Future', level: 'info', startsAt: 2500, endsAt: 3000 },
  ];
  assert.deepEqual(activeAnnouncements(records, 2000).map((row) => row.id), ['second', 'first']);
});
