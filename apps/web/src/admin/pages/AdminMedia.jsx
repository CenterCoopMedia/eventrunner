// Media tab: the cut file — the media library (issue #24; admin story part 2
// "the cut file"). A print shop's cabinet of engravings, not a photo
// gallery: MediaLibrary and its modals live in ../components/media/, which
// is where the whole engravings-cabinet idiom (path and size in the mono,
// thumbnail as evidence) is drawn.
//
// Two drawers, kept apart because they answer different questions —
// `cms-images/` is what goes inside pages and posts, `branding/` is the
// event's identity (§7.2 logo slots). A single mixed grid would make
// "which of these 40 files is the logo?" a guessing game, and the folder is
// already part of every object path.
import { useState } from 'react';
import MediaLibrary from '../components/media/MediaLibrary.jsx';
import AdminPageHeader from '../components/adminChrome.jsx';

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

/** The drawer selector. Never colour alone: the current drawer carries a
 * ground shift, semibold weight, an underline, and `aria-current`. */
function drawerTabClass(active) {
  return [
    'admin-target inline-flex items-center rounded-admin px-sm py-2xs font-admin-ui text-caption',
    active
      ? 'bg-admin-ground-raised font-semibold text-admin-ink underline underline-offset-4'
      : 'text-admin-ink hover:bg-admin-ground-raised',
  ].join(' ');
}

export default function AdminMedia() {
  const [folder, setFolder] = useState(FOLDERS[0]);

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Media"
        description="Every file uploaded to this event, with what references it. Uploads and deletes run server-side — the browser never writes to storage."
      />

      <nav aria-label="Media folders">
        <ul className="flex flex-wrap items-center gap-2xs">
          {FOLDERS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={drawerTabClass(entry.id === folder.id)}
                aria-current={entry.id === folder.id ? 'page' : undefined}
                onClick={() => setFolder(entry)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <p className="text-caption text-admin-ink-secondary">{folder.hint}</p>
      <MediaLibrary key={folder.id} folder={folder.id} />
    </div>
  );
}
