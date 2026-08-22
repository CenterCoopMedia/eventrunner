// Media tab: the library browser (issue #24).
//
// Two namespaces, kept apart because they answer to different questions —
// `cms-images/` is what goes inside pages and posts, `branding/` is the
// event's identity (§7.2 logo slots). A single mixed grid would make
// "which of these 40 files is the logo?" a guessing game, and the folder is
// already part of every object path.
import { useState } from 'react';
import MediaLibrary from '../../components/media/MediaLibrary.jsx';

const FOLDERS = [
  {
    id: 'cms-images',
    label: 'Page images',
    hint: 'Images used inside pages, posts, and sessions.',
  },
  {
    id: 'branding',
    label: 'Branding',
    hint: 'Logos, marks, favicons, and the social sharing card. Slots are assigned on the Branding tab.',
  },
];

function tabClass(active) {
  return [
    'touch-target inline-flex items-center rounded-brand px-3 py-2',
    active
      ? 'font-semibold text-brand-primary-dark underline underline-offset-4'
      : 'text-brand-ink hover:bg-brand-surface-alt',
  ].join(' ');
}

export default function AdminMedia() {
  const [folder, setFolder] = useState(FOLDERS[0]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Media</h1>
        <p className="text-sm text-brand-ink-muted">
          Every file uploaded to this event, with what references it. Uploads and
          deletes run server-side — the browser never writes to storage.
        </p>
      </div>

      <nav aria-label="Media folders">
        <ul className="flex flex-wrap items-center gap-1">
          {FOLDERS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={tabClass(entry.id === folder.id)}
                aria-current={entry.id === folder.id ? 'page' : undefined}
                onClick={() => setFolder(entry)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <p className="text-sm text-brand-ink-muted">{folder.hint}</p>
      <MediaLibrary key={folder.id} folder={folder.id} />
    </div>
  );
}
