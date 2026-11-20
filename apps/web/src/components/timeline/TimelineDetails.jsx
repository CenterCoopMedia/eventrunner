import { timelineHref, timelineImagePath } from '../../lib/timelineEntry.js';
import ExternalLink from '../ExternalLink.jsx';
import { PublicLink } from '../PublicLink.jsx';
import AssetImage from '../media/AssetImage.jsx';
import Timeline from '../editorial/Timeline.jsx';

function renderTitle(entry) {
  const href = timelineHref(entry.url);
  if (href?.startsWith('https://')) {
    return <ExternalLink href={href} rel="noopener noreferrer" className="underline">{entry.title}</ExternalLink>;
  }
  return href ? <PublicLink to={href} className="underline">{entry.title}</PublicLink> : entry.title;
}

function renderMedia(entry) {
  const path = timelineImagePath(entry.image);
  const alt = typeof entry.alt === 'string' ? entry.alt.trim() : '';
  if (!path || !alt) return null;
  return (
    <div className="mt-sm max-w-prose">
      <AssetImage path={path} alt={alt} sizes="(max-width: 40rem) 100vw, 40rem"
        className="h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]" />
    </div>
  );
}

export default function TimelineDetails({ timeline, className }) {
  return <Timeline timeline={timeline} className={className} renderTitle={renderTitle} renderMedia={renderMedia} />;
}
