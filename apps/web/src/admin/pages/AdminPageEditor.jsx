// Page editor (issue #13 — "creating a Scholarships page via the admin CMS").
//
// Maps onto the cmsPages contract exactly (spec §5.2, functions/src/cms/
// pages.cjs):
//   • Save draft      → cmsSavePage. NEVER writes the live doc — the draft
//                       revision goes to cmsPages_drafts with status 'dirty'.
//   • Save & publish   → cmsSavePage, then cmsPublish { collection:
//                       'cmsPages', docIds: [id] } — the revision copy that
//                       makes it public. Two calls because that is what the
//                       two-revision model is: editing and publishing are
//                       separate acts.
//   • Delete          → cmsDeletePage, refused server-side for system pages;
//                       the UI reflects the same rule rather than letting an
//                       operator hit a wall.
//
// `path` is a plain text input validated SERVER-side: root-level paths are
// canonical (issue #52 — `/scholarships`, not `/p/scholarships`), resolved by
// App.jsx's catch-all route, and cmsSavePage owns the rules — segment shape,
// the reserved first segments in shared/routing, '/' being the home page's,
// and uniqueness across both revisions. So this file hardcodes no shape and
// surfaces the server's rejection verbatim; the reserved list below is shown
// as a hint only, read from that same registry so it cannot drift.
//
// Sections carry the block contract: `allowedBlocks` is a palette drawn from
// the BLOCK_TYPES registry, and `defaultBlocks` are the blocks the section
// seeds — each one a (field, blockType) pair whose per-type fields the
// registry describes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RESERVED_PATH_SEGMENTS } from 'shared/routing';
import { useToast } from '../../contexts/ToastContext.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import {
  BLOCK_TYPES,
  BLOCK_TYPE_IDS,
  blockTypeFieldSummary,
  blockTypeLabel,
} from '../blockTypes.js';
import { blankPage, blankSection, toEditablePage, toPagePayload } from '../pageDoc.js';
import { summarizePublish } from '../publishResult.js';
import {
  CheckboxField,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

/** Move item `from` → `to` in a copy of `list`. */
function moved(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminPageEditor({ mode }) {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { rows, loading, findRow } = useAdminPages();

  const [page, setPage] = useState(() => blankPage());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'draft' | 'publish' | 'delete'
  const [status, setStatus] = useState('');
  // Set once a create has landed, so the form switches to editing that
  // document instead of trying to create it again.
  const [savedId, setSavedId] = useState(null);
  // Set when a publish fails part-way: the queue row the retry must resume.
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const errorRef = useRef(null);
  // Load the stored revision once; later listener updates (e.g. the echo of
  // our own save) must not clobber whatever is being typed.
  const loadedIdRef = useRef(null);

  const row = mode === 'edit' ? findRow(pageId) : null;

  useEffect(() => {
    if (mode !== 'edit') return;
    if (loadedIdRef.current === pageId) return;
    const found = rows.find((candidate) => candidate.id === pageId);
    if (!found) return;
    loadedIdRef.current = pageId;
    setPage(toEditablePage(found.draft ?? found.live));
  }, [mode, pageId, rows]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => fieldErrors.get(field);

  if (mode === 'edit' && loading && !row) {
    return <LoadingState label="Loading page…" />;
  }
  if (mode === 'edit' && !loading && !row) {
    return (
      <EmptyState
        title="No such page"
        description="That page id has neither a published nor a draft revision."
        action={
          <Link to=".." relative="path" className={primaryButtonClass}>
            Back to pages
          </Link>
        }
      />
    );
  }

  const update = (patch) => setPage((current) => ({ ...current, ...patch }));
  const updateSection = (index, patch) =>
    setPage((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    }));
  const updateBlock = (sectionIndex, blockIndex, patch) =>
    setPage((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === sectionIndex
          ? {
              ...section,
              defaultBlocks: section.defaultBlocks.map((block, j) =>
                j === blockIndex ? { ...block, ...patch } : block,
              ),
            }
          : section,
      ),
    }));

  async function save({ publish }) {
    setBusy(publish ? 'publish' : 'draft');
    setError(null);
    setStatus('');
    setResumeQueueId(null);
    const payload = toPagePayload(page);
    try {
      await call('cmsSavePage', { page: payload });
      // Mark the document existing the moment the DRAFT is written, before
      // any publish attempt: a failed publish must not leave the id editable,
      // because retrying under a different id would create a second document
      // and orphan the draft that just landed.
      setSavedId(payload.id);
      loadedIdRef.current = payload.id;
      if (!publish) {
        setStatus('Draft saved. It is not public until you publish.');
        showToast('Draft saved.');
        return;
      }
      // Separate call by design: cmsSavePage only ever writes the draft
      // revision; the live doc is cmsPublish's to write (spec §8.4).
      const response = await call('cmsPublish', {
        collection: 'cmsPages',
        docIds: [payload.id],
      });
      reportPublish(response, [payload.id]);
    } catch (err) {
      setError(err);
      // A part-way publish failure carries the queue row to resume from.
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setBusy(null);
    }
  }

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsPages', requestedIds);
    setStatus(verdict.message);
    showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
  }

  /**
   * Resume a publish that failed part-way. Passing { queueId } is what makes
   * the re-run skip the chunks that already committed instead of publishing
   * them a second time (functions/src/cms/publish.cjs).
   */
  async function resumePublish() {
    setBusy('publish');
    setError(null);
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, [savedId ?? page.id]);
    } catch (err) {
      setError(err);
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      await call('cmsDeletePage', { id: page.id });
      showToast('Page deleted.');
      navigate('..', { relative: 'path' });
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const isSystemPage = page.systemPage === true;
  // "Existing" = a document the server has already written: an edited page,
  // or one this form just created.
  const isExisting = mode === 'edit' || savedId !== null;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save({ publish: false });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">
            {mode === 'create' ? 'New page' : page.label || page.id}
          </h1>
          <p className="text-sm text-brand-ink-muted">
            Saving writes a draft. Publishing copies that draft to the live
            revision the public site reads.
          </p>
        </div>
        <Link to=".." relative="path" className={secondaryButtonClass}>
          Back to pages
        </Link>
      </div>

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Page" description="How the page is identified, ordered, and linked.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Page id"
            value={page.id}
            onChange={(value) => update({ id: value })}
            error={errorFor('id')}
            readOnly={isExisting}
            hint={
              isExisting
                ? 'The document id cannot change after creation.'
                : 'Letters, digits, hyphen, underscore. Used as the document id.'
            }
          />
          <TextField
            label="Title"
            value={page.label}
            onChange={(value) => update({ label: value })}
            error={errorFor('label')}
            hint="Shown as the page heading and in navigation."
          />
          <TextField
            label="Path"
            value={page.path}
            onChange={(value) => update({ path: value })}
            error={errorFor('path')}
            hint={`The URL path this page is served at, e.g. /scholarships. These first segments belong to built-in routes and cannot be used: ${RESERVED_PATH_SEGMENTS.join(', ')}.`}
          />
          <TextField
            label="Icon"
            value={page.icon ?? ''}
            onChange={(value) => update({ icon: value || null })}
            error={errorFor('icon')}
            hint="Optional icon name. Leave blank for none."
          />
          <TextField
            label="Order"
            type="number"
            value={page.order}
            onChange={(value) => update({ order: value })}
            error={errorFor('order')}
            hint="Lower numbers sort first."
          />
          <div className="flex flex-col justify-center gap-3">
            <CheckboxField
              label="Visible"
              checked={page.visible}
              onChange={(checked) => update({ visible: checked })}
              hint="Hidden pages stay out of the public site even once published."
            />
            {isSystemPage ? (
              <p className="text-sm text-brand-ink-muted">
                This is a system page: It has a dedicated route in the app, so
                it cannot be deleted or turned into a regular page.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title="Sections"
        description="Each section is a named slot on the page. Its allowed block types come from the block registry; its default blocks are the blocks it seeds."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => update({ sections: [...page.sections, blankSection()] })}
          >
            Add section
          </button>
        }
      >
        {page.sections.length === 0 ? (
          <p className="text-sm text-brand-ink-muted">
            No sections yet. A page with no sections renders nothing.
          </p>
        ) : (
          <ol className="flex flex-col gap-6">
            {page.sections.map((section, sectionIndex) => {
              const at = `sections[${sectionIndex}]`;
              return (
                <li
                  key={sectionIndex}
                  className="rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-heading text-lg font-semibold text-brand-ink">
                      {section.label || section.id || `Section ${sectionIndex + 1}`}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        aria-label={`Move section ${sectionIndex + 1} up`}
                        disabled={sectionIndex === 0}
                        onClick={() =>
                          update({ sections: moved(page.sections, sectionIndex, sectionIndex - 1) })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        aria-label={`Move section ${sectionIndex + 1} down`}
                        disabled={sectionIndex === page.sections.length - 1}
                        onClick={() =>
                          update({ sections: moved(page.sections, sectionIndex, sectionIndex + 1) })
                        }
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className={dangerButtonClass}
                        aria-label={`Remove section ${sectionIndex + 1}`}
                        onClick={() =>
                          update({
                            sections: page.sections.filter((_, i) => i !== sectionIndex),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label={`Section ${sectionIndex + 1} id`}
                      value={section.id}
                      onChange={(value) => updateSection(sectionIndex, { id: value })}
                      error={errorFor(`${at}.id`)}
                      hint="Ties the section to its content blocks."
                    />
                    <TextField
                      label={`Section ${sectionIndex + 1} label`}
                      value={section.label}
                      onChange={(value) => updateSection(sectionIndex, { label: value })}
                      error={errorFor(`${at}.label`)}
                    />
                    <TextField
                      label={`Section ${sectionIndex + 1} max blocks`}
                      type="number"
                      min="1"
                      value={section.maxBlocks}
                      onChange={(value) =>
                        updateSection(sectionIndex, {
                          maxBlocks: value === '' ? '' : Number(value),
                        })
                      }
                      error={errorFor(`${at}.maxBlocks`)}
                    />
                    <div className="flex items-center">
                      <CheckboxField
                        label={`Section ${sectionIndex + 1} is reorderable`}
                        checked={section.reorderable}
                        onChange={(checked) =>
                          updateSection(sectionIndex, { reorderable: checked })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <TextAreaField
                        label={`Section ${sectionIndex + 1} description`}
                        value={section.description}
                        onChange={(value) =>
                          updateSection(sectionIndex, { description: value })
                        }
                        error={errorFor(`${at}.description`)}
                        hint="Guidance for whoever fills this section in."
                      />
                    </div>
                  </div>

                  <fieldset className="mt-4">
                    <legend className="text-sm font-semibold text-brand-ink">
                      Allowed block types
                    </legend>
                    <p className="text-sm text-brand-ink-muted">
                      Which of the registry’s block types this section accepts.
                    </p>
                    {errorFor(`${at}.allowedBlocks`) ? (
                      <p className="text-sm text-danger">{errorFor(`${at}.allowedBlocks`)}</p>
                    ) : null}
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {BLOCK_TYPE_IDS.map((blockTypeId) => (
                        <CheckboxField
                          key={blockTypeId}
                          label={`${BLOCK_TYPES[blockTypeId].label} — section ${sectionIndex + 1}`}
                          checked={section.allowedBlocks.includes(blockTypeId)}
                          hint={blockTypeFieldSummary(blockTypeId)}
                          onChange={(checked) =>
                            updateSection(sectionIndex, {
                              allowedBlocks: checked
                                ? [...section.allowedBlocks, blockTypeId]
                                : section.allowedBlocks.filter((id) => id !== blockTypeId),
                            })
                          }
                        />
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-brand-ink">Blocks</h4>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() =>
                          updateSection(sectionIndex, {
                            defaultBlocks: [
                              ...section.defaultBlocks,
                              {
                                field: '',
                                blockType: section.allowedBlocks[0] ?? BLOCK_TYPE_IDS[0],
                                description: '',
                              },
                            ],
                          })
                        }
                      >
                        Add block to section {sectionIndex + 1}
                      </button>
                    </div>
                    {section.defaultBlocks.length === 0 ? (
                      <p className="mt-2 text-sm text-brand-ink-muted">
                        No blocks yet.
                      </p>
                    ) : (
                      <ol className="mt-2 flex flex-col gap-4">
                        {section.defaultBlocks.map((block, blockIndex) => {
                          const bat = `${at}.defaultBlocks[${blockIndex}]`;
                          const allowed = section.allowedBlocks.length
                            ? section.allowedBlocks
                            : BLOCK_TYPE_IDS;
                          const options = (
                            allowed.includes(block.blockType) || !block.blockType
                              ? allowed
                              : [block.blockType, ...allowed]
                          ).map((id) => ({ value: id, label: blockTypeLabel(id) }));
                          return (
                            <li
                              key={blockIndex}
                              className="rounded-brand border border-brand-ink/10 bg-brand-surface p-3"
                            >
                              <div className="grid gap-3 sm:grid-cols-2">
                                <TextField
                                  label={`Block ${blockIndex + 1} field — section ${sectionIndex + 1}`}
                                  value={block.field}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { field: value })
                                  }
                                  error={errorFor(`${bat}.field`)}
                                />
                                <SelectField
                                  label={`Block ${blockIndex + 1} type — section ${sectionIndex + 1}`}
                                  value={block.blockType}
                                  options={options}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { blockType: value })
                                  }
                                  error={errorFor(`${bat}.blockType`)}
                                  hint={blockTypeFieldSummary(block.blockType)}
                                />
                                <div className="sm:col-span-2">
                                  <TextField
                                    label={`Block ${blockIndex + 1} description — section ${sectionIndex + 1}`}
                                    value={block.description}
                                    onChange={(value) =>
                                      updateBlock(sectionIndex, blockIndex, { description: value })
                                    }
                                    error={errorFor(`${bat}.description`)}
                                  />
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={secondaryButtonClass}
                                  aria-label={`Move block ${blockIndex + 1} up in section ${sectionIndex + 1}`}
                                  disabled={blockIndex === 0}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: moved(
                                        section.defaultBlocks,
                                        blockIndex,
                                        blockIndex - 1,
                                      ),
                                    })
                                  }
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  className={secondaryButtonClass}
                                  aria-label={`Move block ${blockIndex + 1} down in section ${sectionIndex + 1}`}
                                  disabled={blockIndex === section.defaultBlocks.length - 1}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: moved(
                                        section.defaultBlocks,
                                        blockIndex,
                                        blockIndex + 1,
                                      ),
                                    })
                                  }
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  className={dangerButtonClass}
                                  aria-label={`Remove block ${blockIndex + 1} from section ${sectionIndex + 1}`}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: section.defaultBlocks.filter(
                                        (_, j) => j !== blockIndex,
                                      ),
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={secondaryButtonClass} disabled={busy !== null}>
          {busy === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy !== null}
          onClick={() => save({ publish: true })}
        >
          {busy === 'publish' ? 'Publishing…' : 'Save and publish'}
        </button>
        {resumeQueueId ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy !== null}
            onClick={resumePublish}
          >
            {busy === 'publish' ? 'Resuming…' : 'Resume publish'}
          </button>
        ) : null}
        {isExisting ? (
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy !== null || isSystemPage}
            title={
              isSystemPage ? 'System pages cannot be deleted.' : undefined
            }
            onClick={remove}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete page'}
          </button>
        ) : null}
      </div>
    </form>
  );
}
