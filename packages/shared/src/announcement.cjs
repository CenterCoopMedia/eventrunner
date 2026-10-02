'use strict';

const { safeUrlHref } = require('./urlSafety.cjs');

const ANNOUNCEMENT_LEVELS = Object.freeze(['info', 'urgent']);
const MAX_ANNOUNCEMENT_MESSAGE_LENGTH = 500;
const MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH = 80;

/** Plain text only. React escapes it again when it renders. */
function sanitizeAnnouncementText(value, maxLength = MAX_ANNOUNCEMENT_MESSAGE_LENGTH) {
  if (typeof value !== 'string') return '';
  const withoutControls = [...value.normalize('NFC')]
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('');
  return withoutControls
    .replace(/<[^>]*>/gu, ' ')
    .replace(/[<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function announcementTimeMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

/** Sanitize one public record again at its read boundary. */
function readAnnouncement(record) {
  if (!record || typeof record !== 'object') return null;
  const id = typeof record.id === 'string' ? record.id : '';
  const message = sanitizeAnnouncementText(record.message);
  const startsAt = announcementTimeMs(record.startsAt);
  const endsAt = announcementTimeMs(record.endsAt);
  if (!id || !message || startsAt === null || endsAt === null || startsAt >= endsAt) return null;

  const level = ANNOUNCEMENT_LEVELS.includes(record.level) ? record.level : 'info';
  const url = safeUrlHref(record.link?.url);
  const label = sanitizeAnnouncementText(record.link?.label, MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH);
  return {
    id,
    message,
    level,
    startsAt,
    endsAt,
    link: url && label ? { url, label } : null,
  };
}

function activeAnnouncements(records, nowMs = Date.now()) {
  return (Array.isArray(records) ? records : [])
    .map(readAnnouncement)
    .filter((record) => record && record.startsAt <= nowMs && nowMs < record.endsAt)
    .sort((a, b) => b.startsAt - a.startsAt || a.id.localeCompare(b.id));
}

module.exports = {
  ANNOUNCEMENT_LEVELS,
  MAX_ANNOUNCEMENT_MESSAGE_LENGTH,
  MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH,
  sanitizeAnnouncementText,
  announcementTimeMs,
  readAnnouncement,
  activeAnnouncements,
};
