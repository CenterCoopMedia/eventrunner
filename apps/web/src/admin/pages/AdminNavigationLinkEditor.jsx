import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { isNavigationLink, navigationLinkUrl } from 'shared/page';
import { SYSTEM_PAGE_ROUTES, isCanonicalPagePath } from 'shared/routing';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { assignPageIds, toPagePayload } from '../pageDoc.js';
import { useAdminPages } from '../useAdminPages.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { contentError } from '../contentError.js';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState } from '../components/adminChrome.jsx';
import { CheckboxField, Notice, Panel, SelectField, TextField, primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';
import { UnsavedChangesDialog } from '../components/UnsavedChanges.jsx';

const PAGES_PATH = '/admin/pages';

function NavigationLinkForm({ initial, rows, creating }) {
  const call = useAdminApi();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState(navigationLinkUrl(initial.url).startsWith('https://') ? 'external' : 'internal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saved = useRef(false);
  const leave = useUnsavedNavigation(!saved.current && JSON.stringify(draft) !== JSON.stringify(initial), { blocked: saving });
  const paths = new Map();
  for (const { current } of rows) {
    if (isNavigationLink(current)) continue;
    const path = current.systemPage ? SYSTEM_PAGE_ROUTES[current.id]?.to : current.path;
    if (isCanonicalPagePath(path)) paths.set(path, `${current.label} (${path})`);
  }
  if (kind === 'internal' && draft.url && !paths.has(draft.url)) paths.set(draft.url, `${draft.url} (unavailable)`);

  async function save(event) {
    event.preventDefault();
    const url = navigationLinkUrl(draft.url);
    if (!draft.label.trim() || !url || (kind === 'external' ? !url.startsWith('https://') : !paths.has(url))) {
      setError('Enter a menu label and choose a page or enter a valid https URL.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const page = creating
        ? assignPageIds({ ...draft, url }, { pageIds: rows.map((row) => row.id) })
        : { ...draft, url };
      await call('cmsSavePage', { page: toPagePayload(page), ...(creating ? { create: true } : {}) });
      saved.current = true;
      showToast('Navigation link saved as a draft.');
      navigate(PAGES_PATH);
    } catch (failure) {
      setError(contentError(failure, { fallback: 'The navigation link could not be saved.' }).message);
    } finally {
      setSaving(false);
    }
  }

  return <>
    <form className="flex flex-col gap-md" onSubmit={save} inert={leave.pending ? '' : undefined}>
      <AdminPageHeader title={creating ? 'Add a navigation link' : 'Edit navigation link'}
        description="This link joins the Pages list. Set its position there and publish it with your other page drafts."
        actions={<>
          <Link to={PAGES_PATH} className={secondaryButtonClass}>Back to Pages</Link>
          <button type="submit" className={primaryButtonClass} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </>} />
      {error ? <Notice tone="error" message={error} /> : null}
      <Panel>
        <div className="flex flex-col gap-sm">
          <TextField label="Menu label" value={draft.label} maxLength={80} required disabled={saving}
            onChange={(label) => setDraft((current) => ({ ...current, label }))} />
          <SelectField label="Link destination" value={kind} disabled={saving}
            options={[{ value: 'internal', label: 'A page on this site' }, { value: 'external', label: 'An external website' }]}
            onChange={(value) => { setKind(value); setDraft((current) => ({ ...current, url: '' })); }} />
          {kind === 'internal' ? (
            <SelectField label="Page" value={draft.url} required disabled={saving}
              options={[{ value: '', label: 'Choose a page' }, ...Array.from(paths, ([value, label]) => ({ value, label }))]}
              onChange={(url) => setDraft((current) => ({ ...current, url }))} />
          ) : (
            <TextField label="HTTPS URL" type="url" value={draft.url} maxLength={2048} required disabled={saving}
              hint="Visitors open this link in a new tab."
              onChange={(url) => setDraft((current) => ({ ...current, url }))} />
          )}
          <CheckboxField label="Show in the navigation" checked={draft.visible} disabled={saving}
            onChange={(visible) => setDraft((current) => ({ ...current, visible }))} />
        </div>
      </Panel>
    </form>
    {leave.pending ? createPortal(<UnsavedChangesDialog onStay={leave.stay} onDiscard={leave.discard} canDiscard={leave.canDiscard} />, document.body) : null}
  </>;
}

export default function AdminNavigationLinkEditor() {
  const { linkId } = useParams();
  const { rows, ready, loading } = useAdminPages({ includeNavigationLinks: true });
  const creating = linkId === 'new';
  const existing = rows.find((row) => row.id === linkId)?.current;
  if (loading) return <AdminLoadingState label="Loading navigation links…" />;
  if (!ready || (!creating && !isNavigationLink(existing))) {
    return <AdminEmptyState title="Navigation link unavailable" action={<Link to={PAGES_PATH}>Back to Pages</Link>} />;
  }
  const initial = creating
    ? { id: '', label: '', url: '', order: Math.max(0, ...rows.map((row) => row.current.order || 0)) + 1, visible: true, systemPage: false }
    : existing;
  return <NavigationLinkForm key={linkId} initial={initial} rows={rows} creating={creating} />;
}
