import AdminPendingSave, { useAdminSaveState } from '../components/AdminPendingSave.jsx';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { isNavigationLink, navigationLinkUrl } from 'shared/page';
import { SYSTEM_PAGE_ROUTES, isCanonicalPagePath } from 'shared/routing';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { assignPageIds, toPagePayload } from '../pageDoc.js';
import { nextStoredOrder } from '../reorder.js';
import { useAdminPages } from '../useAdminPages.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import { contentError } from '../contentError.js';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState } from '../components/adminChrome.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { CheckboxField, DestructiveConfirm, Notice, Panel, SelectField, TextField, primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';
import { UnsavedChangesDialog } from '../components/UnsavedChanges.jsx';

const PAGES_PATH = '/admin/pages';

function NavigationLinkForm({ initial, rows, creating }) {
  const call = useAdminApi();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const reportDeleted = useDeletedRecord();
  const [baseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState(navigationLinkUrl(initial.url).startsWith('https://') ? 'external' : 'internal');
  const { action: busy, set: setBusy, begin: beginSave, capture: captureUnconfirmed, unconfirmed: unconfirmedSave } = useAdminSaveState(null);
  const [error, setError] = useState('');
  const saved = useRef(false);
  const rejectedIds = useRef(new Set());
  const leave = useUnsavedNavigation(!saved.current && JSON.stringify(draft) !== JSON.stringify(baseline), { blocked: busy !== null });
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
    if (!beginSave('save')) return;
    const page = creating
      ? assignPageIds({ ...draft, url, order: nextStoredOrder(rows) }, { pageIds: [...rows.map((row) => row.id), ...rejectedIds.current] })
      : { ...draft, url };
    try {
      const payload = toPagePayload(page);
      if (creating) {
        await call('cmsSavePage', { page: payload, create: true, expectedRevision: null });
      } else {
        const previous = toPagePayload({ ...baseline, url: navigationLinkUrl(baseline.url) });
        const changes = Object.fromEntries(['label', 'url', 'visible']
          .filter((field) => payload[field] !== previous[field])
          .map((field) => [field, payload[field]]));
        await call('cmsSavePage', { navigationLink: { id: payload.id, ...changes } });
      }
      saved.current = true;
      showToast('Navigation link saved as a draft.');
      navigate(PAGES_PATH);
    } catch (failure) {
      if (captureUnconfirmed(failure)) return;
      if (creating && failure?.status === 409) {
        rejectedIds.current.add(page.id);
        setError('That link ID was already taken. Save again to use a new one.');
      } else {
        setError(contentError(failure, { fallback: 'The navigation link could not be saved.' }).message);
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError('');
    setBusy('delete');
    try {
      const deleted = await call('cmsDeletePage', { id: draft.id });
      saved.current = true;
      reportDeleted({
        ...deleted,
        collection: 'cmsPages',
        docId: draft.id,
        editorPath: `${PAGES_PATH}/links/${encodeURIComponent(draft.id)}`,
        message: 'Navigation link deleted.',
      }, PAGES_PATH);
    } catch (failure) {
      setError(contentError(failure, { fallback: 'The navigation link could not be deleted.' }).message);
      setBusy(null);
    }
  }

  return <>
    <form className="flex flex-col gap-md" onSubmit={save} inert={leave.pending ? '' : undefined}>
      <AdminPendingSave busy={busy === 'save'} to={PAGES_PATH} unconfirmed={unconfirmedSave} />
      <AdminPageHeader title={creating ? 'Add a navigation link' : 'Edit navigation link'}
        description="This link joins the Pages list. Set its position there and publish it with your other page drafts."
        actions={<>
          <Link to={PAGES_PATH} className={secondaryButtonClass}>Back to Pages</Link>
          <button type="submit" className={primaryButtonClass} disabled={busy !== null || unconfirmedSave}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        </>} />
      {error ? <Notice tone="error" message={error} /> : null}
      <Panel>
        <div className="flex flex-col gap-sm">
          <TextField label="Menu label" help="The name visitors see in the site menu."
            value={draft.label} maxLength={80} required disabled={busy !== null}
            onChange={(label) => setDraft((current) => ({ ...current, label }))} />
          <SelectField label="Link destination" help="Choose an existing page or enter an external website address."
            value={kind} disabled={busy !== null}
            options={[{ value: 'internal', label: 'A page on this site' }, { value: 'external', label: 'An external website' }]}
            onChange={(value) => { setKind(value); setDraft((current) => ({ ...current, url: '' })); }} />
          {kind === 'internal' ? (
            <SelectField label="Page" help="The link appears once the destination page is published and visible."
              value={draft.url} required disabled={busy !== null}
              options={[{ value: '', label: 'Choose a page' }, ...Array.from(paths, ([value, label]) => ({ value, label }))]}
              onChange={(url) => setDraft((current) => ({ ...current, url }))} />
          ) : (
            <TextField label="HTTPS URL" help="Copy the full address, starting with https://."
              type="url" value={draft.url} maxLength={2048} required disabled={busy !== null}
              hint="Visitors open this link in a new tab."
              onChange={(url) => setDraft((current) => ({ ...current, url }))} />
          )}
          <CheckboxField label="Show in the navigation" help="Clear this to keep the link in Pages and hide it from the site menu."
            checked={draft.visible} disabled={busy !== null}
            onChange={(visible) => setDraft((current) => ({ ...current, visible }))} />
        </div>
      </Panel>
      {creating ? null : <DestructiveConfirm
        trigger="Delete this link"
        title={`Delete ${initial.label}`}
        confirmLabel="Delete this link"
        busyLabel="Deleting…"
        busy={busy === 'delete'}
        disabled={busy !== null}
        consequence="Visitors stop seeing this link. Both the live link and its draft are removed."
        permanence={<RecordRecovery collection="cmsPages" docId={draft.id} />}
        onConfirm={remove}
      />}
    </form>
    {leave.pending ? createPortal(<UnsavedChangesDialog onStay={leave.stay} onDiscard={leave.discard} canDiscard={leave.canDiscard} />, document.body) : null}
  </>;
}

export default function AdminNavigationLinkEditor() {
  const { linkId } = useParams();
  const { rows, ready, loading } = useAdminPages({ includeNavigationLinks: true });
  const creating = linkId === 'new';
  const existing = rows.find((row) => row.id === linkId)?.current;
  if (loading) return <AdminLoadingState recover label="Loading navigation links…" />;
  if (!ready || (!creating && !isNavigationLink(existing))) {
    return <AdminEmptyState title="Navigation link unavailable" action={<Link to={PAGES_PATH}>Back to Pages</Link>} />;
  }
  const initial = creating
    ? { id: '', label: '', url: '', order: 0, visible: true, systemPage: false }
    : existing;
  return <NavigationLinkForm key={linkId} initial={initial} rows={rows} creating={creating} />;
}
