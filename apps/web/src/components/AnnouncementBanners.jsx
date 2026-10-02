import { useAnnouncements } from '../hooks/useAnnouncements.js';
import { quietActionClass } from './controlClasses.js';
import ExternalLink from './ExternalLink.jsx';
import NoticeBar from './NoticeBar.jsx';

export default function AnnouncementBanners() {
  const announcements = useAnnouncements();
  return announcements.map((announcement) => (
    <NoticeBar key={announcement.id} id={announcement.id} level={announcement.level}>
      <span>{announcement.message}</span>
      {announcement.link ? (
        <ExternalLink href={announcement.link.url} className={`${quietActionClass} ms-sm`}>
          {announcement.link.label}
        </ExternalLink>
      ) : null}
    </NoticeBar>
  ));
}
