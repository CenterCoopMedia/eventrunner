import { PublicLink } from '../PublicLink.jsx';

export default function LatestUpdatesBlock({ block }) {
  if (!block.updates?.length) return null;
  const heading = typeof block.label === 'string' ? block.label.trim() : '';

  return (
    <div>
      {heading ? <h3 lang={block.publicLanguage} className="mb-sm font-heading text-h3 font-semibold">{heading}</h3> : null}
      <ul className="space-y-xs">
        {block.updates.map((update) => (
          <li key={update.id}>
            <PublicLink to={`/updates/${encodeURIComponent(update.id)}`} className="break-words underline underline-offset-4">
              {update.title}
            </PublicLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
