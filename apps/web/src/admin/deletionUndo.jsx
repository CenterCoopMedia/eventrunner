import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { routePage } from '../lib/routePage.jsx';
import { useAdminApi } from './adminApi.js';
import { COLLECTION_CHOICES } from './collectionWords.js';
import { Notice, linkButtonClass, secondaryButtonClass } from './components/formControls.jsx';
import { plannerMessage } from './plannerErrors.js';

const DeletionContext = createContext(null);

export function DeletionUndoProvider({ children }) {
  const { key, pathname } = useLocation();
  const navigate = useNavigate();
  const pending = useRef(null);
  const [result, setResult] = useState(null);
  const reportDeleted = useCallback((record, destination) => {
    if (!destination) {
      pending.current = null;
      setResult((current) => ({ ...record, key, inline: true, sequence: (current?.sequence ?? 0) + 1 }));
      return;
    }
    pending.current = { ...record, destination };
    navigate(destination);
  }, [navigate, key]);

  useEffect(() => {
    const next = pending.current;
    pending.current = null;
    setResult((current) => next?.destination === pathname
      ? { ...next, key }
      : current?.key === key ? current : null);
  }, [key, pathname]);

  const value = useMemo(() => ({ result: result?.key === key ? result : null, reportDeleted }), [result, key, reportDeleted]);
  return <DeletionContext.Provider value={value}>{children}</DeletionContext.Provider>;
}

function useDeletion() {
  const value = useContext(DeletionContext);
  if (!value) throw new Error('DeletionUndoProvider is required.');
  return value;
}

export function useDeletedRecord() {
  return useDeletion().reportDeleted;
}

export function DeletedRecordResult({ owningPageId = null, docId = null, fallback = null }) {
  const { result } = useDeletion();
  const matches = result && (result.inline ? docId === result.docId : docId === null);
  return matches ? <DeletionResult key={`${result.key}:${result.docId}:${result.sequence ?? 0}`} record={result} owningPageId={owningPageId} fallback={docId === null ? null : fallback} /> : fallback;
}

function DeletionResult({ record, owningPageId, fallback }) {
  const call = useAdminApi();
  const [state, setState] = useState({ phase: 'deleted', error: null });
  const undoRef = useRef(null);
  const draftRef = useRef(null);
  const choice = COLLECTION_CHOICES.find((item) => item.id === record.collection);
  const noun = choice?.singular ?? 'record';
  const name = noun.charAt(0).toUpperCase() + noun.slice(1);
  const historyPath = `/admin/versions/${record.collection}/${encodeURIComponent(record.docId)}`;
  const eligible = Boolean(choice)
    && Number.isSafeInteger(record.publishedRevision) && record.publishedRevision > 0
    && (record.collection !== 'cmsSchedule' || record.removedMaterials === 0)
    && (record.collection !== 'cmsOrganizations' || (record.removedRepresentatives === 0 && record.removedQueuedEdit === false))
    && (record.collection !== 'cmsContent' || (owningPageId !== null && owningPageId === record.pageId));

  useEffect(() => {
    if (state.phase === 'restored') draftRef.current?.focus({ preventScroll: true });
    else if (state.phase === 'deleted' && eligible) undoRef.current?.focus({ preventScroll: true });
  }, [state.phase, eligible]);

  if (!eligible && fallback) return fallback;

  async function undo() {
    if (!eligible || state.phase === 'restoring' || state.phase === 'restored') return;
    setState({ phase: 'restoring', error: null });
    try {
      const helpers = await routePage(() => import('./versionHistory.js')).prefetch();
      if (!helpers) throw new Error('The restore controls could not load. Check your connection and try again.');
      const history = await call('cmsGetVersionHistory', {
        docPath: `${record.collection}/${record.docId}`,
        limit: 1,
        cursor: record.publishedRevision + 1,
      });
      const entry = history?.entries?.[0];
      if (entry?.revision !== record.publishedRevision) throw new Error('That published version is not available. Open version history to inspect the saved versions.');
      const request = helpers.restoreRequestFor(record.collection, record.docId, entry, null, { pageId: owningPageId });
      if (!request) throw new Error('This saved version cannot be restored to its page. Open version history to inspect it.');
      await call(request.endpoint, request.body);
      setState({ phase: 'restored', error: null });
    } catch (error) {
      setState({ phase: 'error', error: plannerMessage(error?.fieldErrors?.[0]?.message ?? error?.message) });
    }
  }

  let message = record.message ?? `${name} deleted.`;
  if (state.phase === 'restored') message = `The ${noun} is back as a draft. Publish it to show it on the site.`;
  else if (state.error) message += ` Undo did not finish. ${state.error}`;
  else if (record.collection === 'cmsSchedule' && record.removedMaterials > 0) message += ' Its materials were deleted too. Undo is not available.';
  else if (record.collection === 'cmsOrganizations' && (record.removedRepresentatives > 0 || record.removedQueuedEdit)) {
    if (record.removedRepresentatives > 0) message += ' Its representatives lost access.';
    if (record.removedQueuedEdit) message += ' Its queued edit was removed.';
    message += ' Undo is not available.';
  }

  return (
    <Notice tone={state.error ? 'caution' : 'ok'} message={message}>
      {' '}
      {state.phase === 'restored'
        ? <Link ref={draftRef} to={record.editorPath} className={linkButtonClass}>Open draft</Link>
        : eligible ? <button ref={undoRef} type="button" className={secondaryButtonClass} onClick={undo} disabled={state.phase === 'restoring'} aria-busy={state.phase === 'restoring' || undefined}>{state.phase === 'restoring' ? 'Restoring…' : 'Undo'}</button> : null}
      {state.error ? <> <Link to={historyPath} className={linkButtonClass}>View version history</Link></> : null}
    </Notice>
  );
}
