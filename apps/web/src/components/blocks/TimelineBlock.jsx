import { useContent } from '../../contexts/ContentContext.jsx';
import Timeline from '../editorial/Timeline.jsx';

export default function TimelineBlock({ className }) {
  const { timeline } = useContent();

  const entries = (timeline ?? []).map((entry) => {
    const year = String(entry.year);
    return {
      id: entry.id,
      title: entry.title,
      date: year,
      dateLabel: year,
      body: entry.description,
      href: entry.url,
      image: entry.image,
      alt: entry.alt,
    };
  });
  return <Timeline entries={entries} className={className} />;
}
