// Read-only destinations for the Content browser. These screens all admit
// staff in AdminLayout's docket; their normal route and server gates apply.
// A system page is identified by its stable document id, never by an
// editable label or a stored path that may predate the route guard.
const MANAGEMENT_TARGETS = Object.freeze({
  schedule: { name: 'Sessions', action: 'Manage sessions', to: '/admin/sessions' },
  speakers: { name: 'Speakers', action: 'Manage speakers', to: '/admin/speakers' },
  sponsors: { name: 'Organizations', action: 'Manage organizations', to: '/admin/organizations' },
  attendees: { name: 'Attendees', action: 'Manage attendees', to: '/admin/attendees' },
  updates: { name: 'Updates', action: 'Manage updates', to: '/admin/updates' },
});

export function contentPagePath(pageId) {
  return `/admin/content/${encodeURIComponent(pageId)}`;
}

export function contentSectionPath(pageId, sectionId) {
  return `${contentPagePath(pageId)}/${encodeURIComponent(sectionId)}`;
}

export function pageStructurePath(pageId) {
  return `/admin/pages/${encodeURIComponent(pageId)}`;
}

export function contentManagementTarget(row) {
  if (row.current?.systemPage !== true) return null;
  return Object.prototype.hasOwnProperty.call(MANAGEMENT_TARGETS, row.id)
    ? MANAGEMENT_TARGETS[row.id]
    : null;
}

/** Match the words staff can see, without changing the stored page order. */
export function filterContentPages(rows, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const page = row.current ?? {};
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const text = [page.label || row.id, page.path, ...sections.map((section) => section.label || section.id)]
      .filter(Boolean).join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
