import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { sectionBlockTypes } from 'shared/page';
import { useAdminApi } from '../adminApi.js';
import { BLOCK_TYPE_IDS } from '../blockTypes.js';
import { contentSectionPath } from '../contentBrowser.js';
import { contentBlockTitle } from '../contentDoc.js';
import { useAdminContent } from '../useAdminContent.js';
import { RecordState } from './adminChrome.jsx';
import { Notice, Panel, SelectField, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

function sectionsOf(page) {
  return Array.isArray(page?.sections) ? page.sections : [];
}

function RecoveryRow({ row, destinations, onMoved }) {
  const call = useAdminApi();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestPending = useRef(false);
  const formId = useId();
  const title = contentBlockTitle(row.live ?? row.current);
  const pendingDraft = row.draft?.status === 'dirty';
  const target = destinations.find((option) => option.value === destination);

  async function move(event) {
    event.preventDefault();
    if (requestPending.current || !target) return;
    requestPending.current = true;
    setBusy(true);
    setError('');
    try {
      await call('cmsMoveContent', { docId: row.id, pageId: target.pageId, section: target.sectionId });
      onMoved({ title, target });
      // The authoritative content listener removes this row once it sees the move.
    } catch (err) {
      setError(err.message);
      requestPending.current = false;
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-xs">
      <div className="flex flex-wrap items-center justify-between gap-xs">
        <div className="min-w-0">
          <p className="break-words font-semibold">{title}</p>
          <RecordState state={row.state} />
        </div>
        <button type="button" className={secondaryButtonClass} aria-expanded={open} aria-controls={formId}
          disabled={busy} onClick={() => setOpen(!open)}>
          Move to section…
        </button>
      </div>
      <div id={formId} hidden={!open}>
        {open && (destinations.length ? (
          <form onSubmit={move} className="flex flex-col items-start gap-xs">
            <SelectField label="Destination section" help="Only sections with room for this block are listed."
              value={destination} onChange={setDestination} disabled={busy}
              options={[{ value: '', label: 'Choose a section' }, ...destinations]} />
            {pendingDraft ? (
              <p className="text-admin-sm text-admin-ink-secondary">
                {row.live ? 'This moves the published block. Its saved changes stay in a draft.' : 'This publishes the saved draft.'}
              </p>
            ) : null}
            {error ? <Notice tone="error" message={error} /> : null}
            <button type="submit" className={primaryButtonClass} disabled={busy || !target}>
              {busy ? 'Moving…' : 'Move and publish'}
            </button>
          </form>
        ) : (
          <p className="text-admin-sm text-admin-ink-secondary">Add a section with room for this block type.</p>
        ))}
      </div>
    </li>
  );
}

export default function OrphanedContent({ pages, pagesReady }) {
  const { rows, ready, error } = useAdminContent();
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);
  const headingId = useId();
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  // Home reads hero blocks even when its page document has no hero section.
  const ownedSections = new Set(['hero', ...pages.flatMap(({ live, draft }) =>
    [...sectionsOf(live), ...sectionsOf(draft)].map((section) => section?.id))]);
  const orphans = ready && pagesReady && !error
    ? rows.filter(({ live, draft }) => ![live, draft].some((block) => block?.section && ownedSections.has(block.section)))
    : [];
  const destinations = orphans.length ? pages.flatMap((page) =>
    sectionsOf(page.current).filter((section) => section?.id).map((section) => ({
      value: contentSectionPath(page.id, section.id),
      pageId: page.id,
      sectionId: section.id,
      label: `${page.current.label || 'Untitled page'} · ${section.label || 'Untitled section'}`,
      pageNeedsPublish: !sectionsOf(page.live).some((published) => published?.id === section.id),
      allowed: sectionBlockTypes({ ...page.current, id: page.id }, section, BLOCK_TYPE_IDS),
      hasRoom: Number.isInteger(section.maxBlocks) && rows.filter(({ live, draft }) =>
        live?.section === section.id || draft?.section === section.id).length < section.maxBlocks,
    }))) : [];

  return (
    <>
      {error ? <Notice tone="caution" message="Blocks could not refresh. Check your connection." /> : null}
      {result ? (
        <div ref={resultRef} tabIndex={-1}>
          <Notice tone="ok" message={<>
            Moved “{result.title}” and published the block. {result.target.pageNeedsPublish ? 'Publish the page to show this section. ' : ''}
            <Link to={result.target.value} className="underline">Open {result.target.label}</Link>
          </>} />
        </div>
      ) : null}
      {orphans.length ? (
        <section aria-labelledby={headingId}>
          <Panel className="flex flex-col gap-sm">
            <h2 id={headingId} className="font-admin-ui">Not on any page</h2>
            <ul className="flex flex-col gap-sm" role="list">
              {orphans.map((row) => (
                <RecoveryRow key={row.id} row={row} onMoved={setResult}
                  destinations={destinations.filter(({ allowed, hasRoom }) => hasRoom &&
                    allowed.includes((row.live ?? row.current).blockType) &&
                    (row.draft?.status !== 'dirty' || allowed.includes(row.draft.blockType)))} />
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </>
  );
}
