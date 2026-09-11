// The dashboard's resource cards (issue #169).
//
// LINKS TO THE EVENT'S OWN PAGES, BY PAGE ID. The card knows the ids of the
// pages an attendee needs — how to get here, the answers to common
// questions, the conduct the event asks of them, who to contact — and the
// page document supplies everything a reader reads: the label and the
// destination. No copy lives in this component, so an operator who renames
// their FAQ renames the card; a page that is hidden or was never seeded
// draws no card.
import { Link } from 'react-router-dom';
import { useContent } from '../../contexts/ContentContext.jsx';

// The seeded page ids an attendee is sent to. A page id the event does not
// carry — a seed that never ran, a page an operator hid — resolves to
// nothing and renders nothing.
const RESOURCE_PAGE_IDS = Object.freeze(['travel', 'faq', 'conduct', 'contact']);

export default function ResourceCards() {
  const { pages } = useContent();

  const resources = RESOURCE_PAGE_IDS.map((id) =>
    (Array.isArray(pages) ? pages : []).find(
      (page) => page?.id === id && page.visible !== false && typeof page.path === 'string',
    ),
  ).filter(Boolean);

  if (resources.length === 0) return null;

  return (
    <nav aria-label="Event resources">
      <ul className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
        {resources.map((page) => (
          <li key={page.id}>
            <Link
              to={page.path}
              className="flex h-full flex-col rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-sm font-medium text-text-primary hover:underline"
            >
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
