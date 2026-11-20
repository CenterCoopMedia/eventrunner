import { useEffect, useState } from 'react';
import { parsePath, useLocation } from 'react-router';
import { firstPathSegment, isReservedPathSegment } from 'shared/routing';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useContent } from '../../contexts/ContentContext.jsx';
import { mayHaveSpanish } from '../../contexts/PublicLanguageProvider.jsx';
import { subscribeContentCollection } from '../../lib/contentSource.js';
import { switchedOffSectionFor } from '../../lib/linkTargets.js';
import { publicSubscriptionsForRoute } from '../../lib/publicSubscriptions.js';
import { timelineHref, timelineImagePath, timelineRouteMatch } from '../../lib/timelineEntry.js';
import ExternalLink from '../ExternalLink.jsx';
import { PublicLink } from '../PublicLink.jsx';
import AssetImage from '../media/AssetImage.jsx';
import Timeline from '../editorial/Timeline.jsx';

function renderTitle(entry, features, { readSource, scheduleData, getPublicPage }) {
  const href = timelineHref(entry.url);
  if (!href) return entry.title;
  if (href.startsWith('https://')) {
    return <ExternalLink href={href} rel="noopener noreferrer" className="underline">{entry.title}</ExternalLink>;
  }

  const match = timelineRouteMatch(href);
  if (!match || switchedOffSectionFor(href, features)) return entry.title;
  if (match.route.path === '*') {
    const page = getPublicPage(match.pathname, features);
    if (!page || page.systemPage || isReservedPathSegment(firstPathSegment(match.pathname))) return entry.title;
  }
  if (match.route.path === 'schedule/mine' && !features.sessionBookmarks) return entry.title;
  const { sessionId } = match.params;
  if (sessionId && !scheduleData.some((session) => session.id === sessionId && session.visible)) return entry.title;

  let to = href;
  if (readSource === 'draft') {
    // A link validated against drafts must open using the same source.
    const path = parsePath(href);
    const search = new URLSearchParams(path.search);
    search.set('preview', '1');
    to = { ...path, search: `?${search}` };
  }
  return <PublicLink to={to} className="underline">{entry.title}</PublicLink>;
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
  const { eventConfig, features } = useEventConfig();
  const { readSource, scheduleData, getPublicPage } = useContent();
  const { pathname, search } = useLocation();
  const [liveSchedule, setLiveSchedule] = useState(null);
  const routeReadsSchedule = readSource === 'draft' || mayHaveSpanish(eventConfig)
    || publicSubscriptionsForRoute(pathname, search, features.webmcpPublic === true).includes('cmsSchedule');
  const needsSchedule = features.schedule && !routeReadsSchedule
    && timeline.some((entry) => timelineRouteMatch(entry.url)?.params.sessionId);

  useEffect(() => {
    // History and other Timeline placements can link to a session from a
    // route that doesn't read the schedule. Listen only while that link is in use.
    if (!needsSchedule) return undefined;
    return subscribeContentCollection('cmsSchedule', 'published', setLiveSchedule);
  }, [needsSchedule]);

  const content = { readSource, getPublicPage, scheduleData: (needsSchedule && liveSchedule) || scheduleData };
  return <Timeline timeline={timeline} className={className}
    renderTitle={(entry) => renderTitle(entry, features, content)} renderMedia={renderMedia} />;
}
