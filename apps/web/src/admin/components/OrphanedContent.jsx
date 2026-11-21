import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { sectionBlockTypes } from 'shared/page';
import { useAdminApi } from '../adminApi.js';
import { BLOCK_TYPE_IDS } from '../blockTypes.js';
import { contentSectionPath } from '../contentBrowser.js';
import { contentBlockTitle } from '../contentDoc.js';
import { RECORD_STATE_WORDS } from '../recordState.js';
import { useAdminContent } from '../useAdminContent.js';
import { RecordState, StatusBadge } from './adminChrome.jsx';
import { Notice, Panel, SelectField, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

const recoveryCopy = {
  en: {
    heading: 'Not on any page', hidden: 'Hidden', draft: RECORD_STATE_WORDS.draft,
    open: 'Move to section…', destination: 'Destination section', choose: 'Choose a section',
    help: 'Only sections with room for this block are listed.',
    noRoom: 'Add a section with room for this block type.',
    draftOnly: 'You can move this block here as a draft.',
    savedEdits: 'Publishing now moves the published version. Its saved changes stay in a draft.',
    publishesDraft: 'Publishing now uses the saved draft.',
    moving: 'Moving…', moveDraft: 'Move as draft', movePublish: 'Move and publish',
    movedDraft: (title) => <>Moved “{title}” as a draft.</>,
    movedPublish: (title) => <>Moved “{title}” and published the block.</>,
    publishPage: 'Publish the page to show this section.',
    openSection: 'Open',
    refreshError: 'Blocks could not refresh. Check your connection.',
    untitledPage: 'Untitled page', untitledSection: 'Untitled section',
  },
  es: {
    heading: 'Sin página asignada', hidden: 'Oculto', draft: 'Borrador',
    open: 'Mover a una sección…', destination: 'Sección de destino', choose: 'Elige una sección',
    help: 'Solo se muestran las secciones con espacio para este bloque.',
    noRoom: 'Añade una sección con espacio para este tipo de bloque.',
    draftOnly: 'Puedes mover este bloque aquí como borrador.',
    savedEdits: 'Si publicas ahora, se mueve la versión publicada. Los cambios guardados quedan en un borrador.',
    publishesDraft: 'Si publicas ahora, se usa el borrador guardado.',
    moving: 'Moviendo…', moveDraft: 'Mover como borrador', movePublish: 'Mover y publicar',
    movedDraft: (title) => <>Se movió «{title}» como borrador.</>,
    movedPublish: (title) => <>Se movió y publicó el bloque «{title}».</>,
    publishPage: 'Publica la página para mostrar esta sección.',
    openSection: 'Abrir',
    refreshError: 'No se pudieron actualizar los bloques. Comprueba tu conexión.',
    untitledPage: 'Página sin título', untitledSection: 'Sección sin título',
  },
};

function sectionsOf(page) {
  return Array.isArray(page?.sections) ? page.sections : [];
}

function contentToMove(row, asDraft) {
  return asDraft && row.draft?.status === 'dirty' ? row.draft : row.live ?? row.current;
}

function canMoveTo(row, { pageId, sectionId, allowed, hasRoom, occupied }, asDraft) {
  const source = contentToMove(row, asDraft);
  const blockTypes = !asDraft && row.live && row.draft?.status === 'dirty'
    ? [source.blockType, row.draft.blockType] : [source.blockType];
  if (!hasRoom || !blockTypes.every((type) => allowed.includes(type))) return false;
  if (sectionId === 'hero') {
    const textTaken = blockTypes.includes('text') && (!['title', 'subtitle'].includes(source.field) ||
      occupied.some((block) => block.field === source.field || block.id === `hero__${source.field}`));
    return pageId === 'home' && !textTaken &&
      !(blockTypes.includes('image') && occupied.some((block) => block.blockType === 'image'));
  }
  return !(pageId === 'home' && sectionId === 'sponsors' && occupied.some((block) => block.blockType === 'text'));
}

function RecoveryRow({ row, destinations, copy, onMoved }) {
  const call = useAdminApi();
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [busyAction, setBusyAction] = useState(null);
  const [error, setError] = useState('');
  const requestPending = useRef(false);
  const formId = useId();
  const title = contentBlockTitle(row.live ?? row.current);
  const pendingDraft = row.draft?.status === 'dirty';
  const busy = busyAction !== null;
  const target = destinations.find((option) => option.value === destination);

  async function move(event) {
    event.preventDefault();
    const asDraft = event.nativeEvent.submitter?.value !== 'publish';
    if (requestPending.current || !(asDraft ? target?.canDraft : target?.canPublish)) return;
    requestPending.current = true;
    setBusyAction(asDraft ? 'draft' : 'publish');
    setError('');
    try {
      await call(asDraft ? 'cmsMoveContentAsDraft' : 'cmsMoveContent', {
        docId: row.id, pageId: target.pageId, section: target.sectionId,
      });
      onMoved({ title: contentBlockTitle(contentToMove(row, asDraft)), target, asDraft });
      // The authoritative content listener removes this row once it sees the move.
    } catch (err) {
      setError(err.message);
      requestPending.current = false;
      setBusyAction(null);
    }
  }

  return (
    <li className="flex flex-col gap-xs">
      <div className="flex flex-wrap items-center justify-between gap-xs">
        <div className="min-w-0">
          <p className="break-words font-semibold" lang="">{title}</p>
          {row.live ? <StatusBadge tone="neutral">{copy.hidden}</StatusBadge>
            : <RecordState state={{ ...row.state, label: copy.draft }} />}
        </div>
        <button type="button" className={secondaryButtonClass} aria-expanded={open} aria-controls={formId}
          disabled={busy} onClick={() => setOpen(!open)}>
          {copy.open}
        </button>
      </div>
      <div id={formId} hidden={!open}>
        {open && (destinations.length ? (
          <form onSubmit={move} className="flex flex-col items-start gap-xs">
            <SelectField label={copy.destination} help={copy.help}
              value={destination} onChange={setDestination} disabled={busy}
              options={[{ value: '', label: copy.choose }, ...destinations]} />
            {target && !target.canPublish ? (
              <p className="text-admin-sm text-admin-ink-secondary">{copy.draftOnly}</p>
            ) : pendingDraft ? (
              <p className="text-admin-sm text-admin-ink-secondary">
                {row.live ? copy.savedEdits : copy.publishesDraft}
              </p>
            ) : null}
            {error ? <Notice tone="error" message={<span lang="en">{error}</span>} /> : null}
            <div className="flex flex-wrap gap-xs">
              <button type="submit" value="draft" className={secondaryButtonClass} disabled={busy || !target?.canDraft}>
                {busyAction === 'draft' ? copy.moving : copy.moveDraft}
              </button>
              <button type="submit" value="publish" className={primaryButtonClass} disabled={busy || !target?.canPublish}>
                {busyAction === 'publish' ? copy.moving : copy.movePublish}
              </button>
            </div>
          </form>
        ) : (
          <p className="text-admin-sm text-admin-ink-secondary">{copy.noRoom}</p>
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
  const language = /^es(?:-|$)/i.test(globalThis.navigator?.language ?? '') ? 'es' : 'en';
  const copy = recoveryCopy[language];
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  // Home reads hero blocks even when its page document has no hero section.
  const ownedSections = new Set(['hero', ...pages.flatMap(({ live, draft }) =>
    [...sectionsOf(live), ...sectionsOf(draft)].map((section) => section?.id))]);
  const orphans = ready && pagesReady && !error
    ? rows.filter(({ live, draft }) => ![live, draft].some((block) => block?.section && ownedSections.has(block.section)))
    : [];
  const destinations = orphans.length ? pages.flatMap((page) =>
    sectionsOf(page.current).filter((section) => section?.id).map((section) => {
      const sectionRows = rows.filter(({ live, draft }) => live?.section === section.id || draft?.section === section.id);
      return {
        value: contentSectionPath(page.id, section.id),
        pageId: page.id,
        sectionId: section.id,
        label: `${page.current.label || copy.untitledPage} · ${section.label || copy.untitledSection}`,
        lang: page.current.label || section.label ? '' : language,
        pageNeedsPublish: !sectionsOf(page.live).some((published) => published?.id === section.id),
        allowed: sectionBlockTypes({ ...page.current, id: page.id }, section, BLOCK_TYPE_IDS),
        hasRoom: Number.isInteger(section.maxBlocks) && sectionRows.length < section.maxBlocks,
        occupied: sectionRows.flatMap(({ live, draft }) => [live, draft]).filter((block) => block?.section === section.id),
      };
    })) : [];

  const movedTitle = result && <span lang="">{result.title}</span>;
  return (
    <>
      {error ? <div lang={language}><Notice tone="caution" message={copy.refreshError} /></div> : null}
      {result ? (
        <div ref={resultRef} tabIndex={-1} lang={language}>
          <Notice tone="ok" message={<>
            {result.asDraft ? copy.movedDraft(movedTitle) : copy.movedPublish(movedTitle)}{' '}
            {!result.asDraft && result.target.pageNeedsPublish ? `${copy.publishPage} ` : ''}
            <Link to={result.target.value} className="underline">
              {copy.openSection} <span lang={result.target.lang}>{result.target.label}</span>
            </Link>
          </>} />
        </div>
      ) : null}
      {orphans.length ? (
        <section aria-labelledby={headingId} lang={language}>
          <Panel className="flex flex-col gap-sm">
            <h2 id={headingId} className="font-admin-ui">{copy.heading}</h2>
            <ul className="flex flex-col gap-sm" role="list">
              {orphans.map((row) => (
                <RecoveryRow key={row.id} row={row} copy={copy} onMoved={setResult}
                  destinations={destinations.map((option) => ({
                    ...option, canDraft: canMoveTo(row, option, true), canPublish: canMoveTo(row, option, false),
                  })).filter(({ canDraft, canPublish }) => canDraft || canPublish)} />
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </>
  );
}
