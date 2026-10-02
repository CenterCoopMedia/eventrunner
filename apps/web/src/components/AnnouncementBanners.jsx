import { useAnnouncements } from '../hooks/useAnnouncements.js';
import { quietActionClass } from './controlClasses.js';
import ExternalLink from './ExternalLink.jsx';
import NoticeBar from './NoticeBar.jsx';

function dismissalId(announcement) {
  return JSON.stringify([
    announcement.id,
    announcement.message,
    announcement.level,
    announcement.startsAt,
    announcement.endsAt,
    announcement.link?.url ?? '',
    announcement.link?.label ?? '',
  ]);
}

export default function AnnouncementBanners() {
  const announcements = useAnnouncements();
  return announcements.map((announcement) => (
    <NoticeBar key={announcement.id} id={dismissalId(announcement)} level={announcement.level}>
      <span>{announcement.message}</span>
      {announcement.link ? (
        <ExternalLink href={announcement.link.url} className={`${quietActionClass} ms-sm`}>
          {announcement.link.label}
        </ExternalLink>
      ) : null}
    </NoticeBar>
  ));
}
