// Display text for version and publishing screens. Stored identifiers stay in requests only.
const FIELD_LABELS = {
  title: 'Title', name: 'Name', label: 'Label', question: 'Question', answer: 'Answer',
  description: 'Description', body: 'Message', summary: 'Summary', value: 'Content',
  visible: 'Shown on the site', year: 'Year', url: 'Link', href: 'Link', website: 'Website',
  alt: 'Image description', caption: 'Caption', order: 'Order', heading: 'Heading',
  day: 'Day', startTime: 'Start time', endTime: 'End time', location: 'Location',
  featured: 'Featured', sections: 'Sections', items: 'Items', links: 'Links',
  image: 'Image', imagePath: 'Image', imageAlt: 'Image description', logo: 'Logo',
  logoPath: 'Logo', buttonLabel: 'Button text', buttonHref: 'Button link',
  publishAt: 'Publish time', expiresAt: 'End time', pinned: 'Pinned',
};

export function versionFieldLabel(path) {
  const segments = String(path).split('.');
  if (segments.some((segment) => !/^\d+$/.test(segment) && !Object.hasOwn(FIELD_LABELS, segment))) return null;
  return segments.map((segment) => /^\d+$/.test(segment) ? `Item ${Number(segment) + 1}` : FIELD_LABELS[segment]).join(': ');
}

export function versionPlainText(value) {
  if (typeof value !== 'string') return '';
  const holder = document.createElement('template');
  holder.innerHTML = value;
  for (const node of holder.content.querySelectorAll('script, style, iframe, object, template, svg, math')) node.remove();
  return holder.content.textContent.replace(/\s+/g, ' ').trim();
}

export function versionRecordName(collection, doc, { full = false } = {}) {
  for (const key of ['title', 'name', 'label', 'question']) {
    const value = typeof doc?.[key] === 'string' ? doc[key].trim() : '';
    if (value) return !full && value.length > 80 ? `${value.slice(0, 79)}…` : value;
  }
  if (collection === 'cmsContent') {
    const text = versionPlainText(doc?.value);
    if (text && !/^(?:https?:|gs:|javascript:|data:|\/|[\w-]+\/)/i.test(text)) return !full && text.length > 80 ? `${text.slice(0, 79)}…` : text;
    return 'Content block';
  }
  return ({ cmsPages: 'Untitled page', cmsSchedule: 'Untitled session', cmsOrganizations: 'Unnamed organization', cmsUpdates: 'Untitled update', cmsTimeline: 'Timeline entry' })[collection] ?? 'Untitled item';
}

export function versionAuthor(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : 'Team member';
}

export function versionValue(value, { path = '' } = {}) {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^(?:javascript|data):/i.test(value)) return 'Link unavailable';
    if (/image|logo/i.test(path) || /^(?:(?:media|uploads|cmsMedia|cms-images|branding|session-materials|profile-photos|profilePhotos|avatars)\/|gs:\/\/)/.test(value)) {
      const name = value.split(/[?#]/)[0].split('/').pop();
      try { return decodeURIComponent(name).split('/').pop() || 'File'; } catch { return name || 'File'; }
    }
    return versionPlainText(value) || 'No text';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    const names = value.map((item) => typeof item === 'object' && item !== null ? versionPlainText(item.title || item.name || item.label) : '').filter(Boolean);
    return names.length === value.length ? names.join(', ') : `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }
  return 'Content updated';
}
