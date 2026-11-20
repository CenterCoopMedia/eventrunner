import { lazy, Suspense } from 'react';
import { useContent } from '../../contexts/ContentContext.jsx';
import Timeline from './Timeline.jsx';

const TimelineDetails = lazy(() => import('./TimelineDetails.jsx'));

export default function PublishedTimeline({ className }) {
  const { timeline } = useContent();
  const list = <Timeline timeline={timeline} className={className} />;
  if (!timeline?.some((entry) => entry.url || entry.image)) return list;

  // Keep the ordered list readable while the optional details load.
  return (
    <Suspense fallback={list}>
      <TimelineDetails timeline={timeline} className={className} />
    </Suspense>
  );
}
