import AdminPendingSave, { useAdminSaveState } from '../components/AdminPendingSave.jsx';
import { plannerError } from '../plannerErrors.js';
import '../plannerFields.css';
import PlannerSwitch from '../components/PlannerSwitch.jsx';
// The organization editor (issue #192): create or edit one cmsOrganizations
// record through the generic content endpoints, and publish it through
// cmsPublish like every other editor.
//
//   Save draft        → cmsCreateContent (the first save) or cmsUpdateContent
//   Save and publish  → the same save, then cmsPublish for this record
//   Delete            → cmsDeleteContent, removing live and draft together
//
// Below the form, a saved organization lists its representatives and any
// edit one of them sent for review (issue #334,
// components/OrganizationRepresentatives.jsx). It sits outside the form, so
// adding a representative never saves the organization.
//
// The page address is the document id, set once from the name. A form
// creates at most once: as soon as the create succeeds the page moves to
// the record's own address, and every later save from it is an update, so a
// publish that fails after a create is retried as an update rather than
// meeting the "address in use" refusal about its own record.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { summarizePublish } from '../publishResult.js';
import {
  nextOrganizationOrder,
  organizationFields,
  organizationSlugFromName,
  tiersInUse,
  validateOrganizationForm,
} from '../organizationDoc.js';
import { useAdminOrganizations } from '../useAdminOrganizations.js';
import { useOrganizationRepresentatives } from '../useOrganizationRepresentatives.js';
import OrganizationRepresentatives from '../components/OrganizationRepresentatives.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { NewTabNote } from '../../components/ExternalLink.jsx';
import ImagePicker from '../components/media/ImagePicker.jsx';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import BusyLabel from '../../components/BusyLabel.jsx';

const COLLECTION = 'cmsOrganizations';
const ORGANIZATIONS_LIST = '/admin/organizations';

const EMPTY = Object.freeze({
  slug: '',
  name: '',
  tier: '',
  order: '',
  logoPath: '',
  url: '',
  description: '',
  visible: true,
});

const textOf = (value) => (typeof value === 'string' ? value : '');

function toForm(row) {
  const organization = row?.current ?? {};
  return {
    slug: row?.id ?? '',
    name: textOf(organization.name),
    tier: textOf(organization.tier),
    order: Number.isFinite(organization.order) ? String(organization.order) : '',
    logoPath: textOf(organization.logoPath),
    url: textOf(organization.url),
    description: textOf(organization.description),
    visible: organization.visible !== false,
  };
}

export default function AdminOrganizationEditor({ mode }) {
  const { organizationId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const reportDeleted = useDeletedRecord();
  const { showToast } = useToast();
  const { rows, loading, ready, error: listenerError, findRow } = useAdminOrganizations();
  const representatives = useOrganizationRepresentatives();
  const [{ form, savedForm }, setEditor] = useState({ form: EMPTY, savedForm: EMPTY });
  const [slugTouched, setSlugTouched] = useState(false);
  // The id this form created, once it has. From then on it only updates.
  const [createdId, setCreatedId] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const { action: action, set: setAction, begin: beginSave, capture: captureUnconfirmed, unconfirmed: unconfirmedSave } = useAdminSaveState(null);
  const saving = action !== null || unconfirmedSave;
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(null);
  const observedRef = useRef(null);
  const orderDefaultedRef = useRef(false);
  const tierListId = useId();

  const creating = mode === 'create' && !createdId;
  const docId = mode === 'edit' ? organizationId : createdId;
  const row = docId ? findRow(docId) : null;

  // Each record is adopted only after BOTH listeners have reported:
  // a row built before the drafts arrive is the live doc alone, and a form
  // filled from it and saved would replace the unpublished draft.
  useEffect(() => {
    if (mode !== 'edit' || !ready || !row || saving) return;
    const incoming = toForm(row);
    const observed = observedRef.current;
    observedRef.current = incoming;
    if (adoptedRef.current === docId) {
      // An unrelated snapshot can arrive before the echo of our own save.
      // Only values that changed on the listener can replace our baseline.
      const changed = Object.keys(incoming).filter((field) => incoming[field] !== observed[field]);
      if (changed.length === 0) return;
      setEditor((current) => {
        const next = { ...current.form };
        const baseline = { ...current.savedForm };
        for (const field of changed) {
          if (next[field] === baseline[field]) next[field] = incoming[field];
          baseline[field] = incoming[field];
        }
        return { form: next, savedForm: baseline };
      });
      return;
    }
    adoptedRef.current = docId;
    setEditor({ form: incoming, savedForm: incoming });
    setTouched(new Set());
    setAttempted(false);
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
  }, [mode, docId, ready, row, saving]);

  // A new organization joins the end of the wall unless the operator says
  // otherwise.
  useEffect(() => {
    if (mode !== 'create' || loading || orderDefaultedRef.current) return;
    orderDefaultedRef.current = true;
    setEditor((current) => (current.form.order === ''
      ? { ...current, form: { ...current.form, order: String(nextOrganizationOrder(rows)) } }
      : current));
  }, [mode, loading, rows]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  const localErrors = useMemo(
    () => validateOrganizationForm(form, {
      mode: creating ? 'create' : 'edit',
      takenIds: rows.map((candidate) => candidate.id),
    }),
    [form, creating, rows],
  );
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  // A field's own check shows once the operator has typed in it or pressed
  // save, so a blank new form does not open on a column of errors.
  const errorFor = (field) =>
    ((attempted || touched.has(field)) ? localErrors.get(field) : undefined) ?? serverErrors.get(field);
  const formFields = organizationFields(form);
  const savedFields = organizationFields(savedForm);
  const isUnsaved = (field) => formFields[field] !== savedFields[field];
  const visibilityChanged = form.visible !== savedForm.visible;
  const setForm = (update) => setEditor((current) => ({ ...current, form: update(current.form) }));
  const set = (field, value) => {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function save({ publish = false } = {}) {
    if (saving) return;
    // The submit control stays enabled while a field is invalid (#219): a
    // press moves the operator to the field that stopped the save, and
    // sends nothing.
    if (localErrors.size > 0) {
      setAttempted(true);
      setFocusRequest((count) => count + 1);
      return;
    }
    if (!beginSave(publish ? 'publish' : 'draft')) return;
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    // The server merges onto the latest draft. The sponsors list owns order.
    const fields = creating ? formFields : Object.fromEntries(
      Object.entries(formFields).filter(([field, value]) => field !== 'order' && value !== savedFields[field]),
    );
    const body = { collection: COLLECTION, fields };
    if (creating || visibilityChanged) body.visible = form.visible;
    let stage = 'save';
    try {
      let id = docId;
      if (creating) {
        id = form.slug;
        await call('cmsCreateContent', { ...body, docId: id });
        // Created: this form never creates again, and the page moves to the
        // record's own address before the publish runs.
        adoptedRef.current = id;
        observedRef.current = form;
        setCreatedId(id);
        setEditor((current) => ({ ...current, savedForm: form }));
        navigate(`${ORGANIZATIONS_LIST}/${encodeURIComponent(id)}`, { replace: true });
      } else {
        await call('cmsUpdateContent', { ...body, docId: id });
        const savedChanges = Object.fromEntries(Object.keys(fields).map((field) => [field, form[field]]));
        if ('visible' in body) savedChanges.visible = body.visible;
        setEditor((current) => ({ ...current, savedForm: { ...current.savedForm, ...savedChanges } }));
      }
      if (publish) {
        stage = 'publish';
        const response = await call('cmsPublish', { collection: COLLECTION, docIds: [id] });
        const verdict = summarizePublish(response, COLLECTION, [id], 'organizations');
        if (!verdict.ok) throw new Error(verdict.message);
        setStatus(verdict.message);
        if (creating) showToast(verdict.message, { announce: false });
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        if (creating) showToast('Organization draft saved.', { announce: false });
      }
    } catch (err) {
      if (captureUnconfirmed(err)) return;
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      setError(plannerError(err));
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    setAction('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      const deleted = await call('cmsDeleteContent', { collection: COLLECTION, docId });
      reportDeleted({ ...deleted, collection: COLLECTION, docId, editorPath: `${ORGANIZATIONS_LIST}/${encodeURIComponent(docId)}` }, ORGANIZATIONS_LIST);
    } catch (err) {
      setErrorTitle('The organization was not deleted');
      setError(plannerError(err));
    } finally {
      setAction(null);
    }
  }

  if (mode === 'edit' && createdId !== docId && !ready) {
    // A listener failed before both had reported. The form stays closed
    // rather than opening on one revision; the listener retries, and the
    // form opens when both are in.
    if (listenerError) {
      return (
        <Notice
          tone="caution"
          message="The organization did not load. Reconnecting…"
        />
      );
    }
    return <AdminLoadingState recover label="Loading organization…" />;
  }
  if (mode === 'edit' && createdId !== docId && !row) {
    return (
      <AdminEmptyState
        title="No such organization"
        description="That organization may have been deleted. Open the list to choose another."
        action={<Link to={ORGANIZATIONS_LIST} className={secondaryButtonClass}>Back to organizations</Link>}
      />
    );
  }

  if (mode === 'edit' && adoptedRef.current !== docId) {
    return <AdminLoadingState recover label="Loading organization…" />;
  }

  const tiers = tiersInUse(rows);

  // Applied text is already in the draft. Keep any typing since Apply began.
  const adoptApplied = (fields) => {
    setEditor((current) => {
      const next = { ...current.form };
      const baseline = { ...current.savedForm };
      for (const [field, value] of Object.entries(fields)) {
        if (!Object.hasOwn(EMPTY, field) || baseline[field] !== savedForm[field]) continue;
        if (next[field] === form[field]) next[field] = textOf(value);
        baseline[field] = textOf(value);
      }
      return { form: next, savedForm: baseline };
    });
  };

  return (
    <div className="flex flex-col gap-md">
      <form
        ref={formRef}
        className="flex flex-col gap-md"
        noValidate
        onSubmit={(event) => { event.preventDefault(); save(); }}
      >
        <AdminPageHeader help="Edit the details attendees see on the sponsors page."
          title={creating ? 'New organization' : form.name || 'Unnamed organization'}
          recentTitle={row?.current?.name}
          state={!creating && row ? <RecordState state={row.state} /> : null}
          identifiers={null}
          description="Edit the details attendees see on the sponsors page."
          feedback={status || error ? <EditorActionFeedback unsaved={visibilityChanged || Object.keys(formFields).some(isUnsaved)} status={status} error={error} errorTitle={errorTitle} /> : null}
          actions={
            <>
              {!creating ? (
                <Link
                  to={`/sponsors/${encodeURIComponent(docId)}?preview=1`}
                  target="_blank"
                  rel="noreferrer"
                  className={linkButtonClass}
                >
                  Preview draft
                  <NewTabNote />
                </Link>
              ) : null}
              <button
                type="submit"
                className={secondaryButtonClass}
                disabled={saving}
                aria-busy={action === 'draft' || undefined}
              >
                <BusyLabel busy={action === 'draft'} pending="Saving the organization…">Save</BusyLabel>
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={saving}
                aria-busy={action === 'publish' || undefined}
                onClick={() => save({ publish: true })}
              >
                <BusyLabel busy={action === 'publish'} pending="Publishing the organization…">Publish</BusyLabel>
              </button>
          </>
          }
        />

        <AdminPendingSave busy={action === 'draft' || action === 'publish'} to={creating ? '/admin/organizations' : '.'} unconfirmed={unconfirmedSave} />
        <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />

        <div className="admin-editor-layout admin-editor-layout--organization">
          <Panel help="The name, introduction, and website shown to attendees."
            title="Public details"
            description="The name, introduction, and website shown to attendees."
            className="admin-editor-card--primary"
          >
            <div className="flex flex-col gap-sm">
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Name"
                value={form.name}
                onChange={(value) => {
                  set('name', value);
                  if (creating && !slugTouched) {
                    setForm((current) => ({ ...current, slug: organizationSlugFromName(value) }));
                  }
                }}
                error={errorFor('name')}
                required
              />
              {creating ? (
                <TextField hint="Choose the end of the page link. This is fixed after the first save." help="Choose the end of the page link. This is fixed after the first save."
                  label="Page address"
                  
                  value={form.slug}
                  onChange={(value) => {
                    setSlugTouched(true);
                    set('slug', value);
                  }}
                  error={errorFor('slug')}
                  autoCapitalize="none"
                  spellCheck={false}
                  className="font-admin-data"
                  required
                />
              ) : null}
              <TextAreaField help="One or two sentences on what this organization supports."
                label="Description"
                
                rows={3}
                value={form.description}
                onChange={(value) => set('description', value)}
                error={errorFor('description')}
              />
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Website"
                type="url"
                value={form.url}
                onChange={(value) => set('url', value)}
                error={errorFor('url')}
              />
            </div>
          </Panel>

          <div className="admin-editor-stack">
            <Panel help="Choose the sponsor group and whether this organization appears after publishing." title="Placement" description="Set the group and visibility here. The sponsors list sets the order.">
              <div className="admin-editor-fields planner-fields grid gap-sm sm:grid-cols-2">
                <div>
                  <TextField help="Choose an existing tier to group sponsors together."
                    label="Tier"
                    
                    value={form.tier}
                    onChange={(value) => set('tier', value)}
                    error={errorFor('tier')}
                    list={tiers.length > 0 ? tierListId : undefined}
                  />
                  {tiers.length > 0 ? (
                    <datalist id={tierListId}>
                      {tiers.map((tier) => <option key={tier} value={tier} />)}
                    </datalist>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <PlannerSwitch help="Include this organization on the public sponsors page after publishing."
                    label="Show on the sponsors page"
                    checked={form.visible}
                    onChange={(value) => set('visible', value)}
                  />
                </div>
              </div>
            </Panel>

            <Panel help="The organization’s mark on its page and the sponsor wall." title="Logo" description="The organization’s mark on its page and the sponsor wall.">
              <ImagePicker help="Choose or upload a logo."
                label="Logo"
                
                folder="cms-images"
                value={form.logoPath}
                onChange={(value) => set('logoPath', value)}
                error={errorFor('logoPath')}
              />
            </Panel>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-xs">
          <button type="button" className={secondaryButtonClass} onClick={() => navigate(ORGANIZATIONS_LIST)}>
            Cancel
          </button>
          {!creating ? (
            <DestructiveConfirm
              className="ms-auto"
              trigger="Delete this organization"
              triggerIcon="delete"
              title={`Delete ${form.name || 'Unnamed organization'}`}
              confirmLabel="Delete this organization"
              busyLabel="Deleting…"
              busy={action === 'delete'}
              disabled={saving}
              consequence="The live organization and its draft are removed. Its page address is free again. The logo stays in the media library. Its representatives lose access, and an edit waiting for review is removed."
              permanence={<RecordRecovery collection="cmsOrganizations" docId={docId} />}
              onConfirm={remove}
            />
          ) : null}
        </div>
      </form>
      {!creating && docId && (representatives.ready || representatives.error) ? (
        <OrganizationRepresentatives
          key={docId}
          organizationId={docId}
          current={row?.current ?? null}
          grants={representatives.grantsFor(docId)}
          request={representatives.requestFor(docId)}
          listenerError={representatives.error}
          isUnsaved={isUnsaved}
          onApplied={adoptApplied}
        />
      ) : null}
    </div>
  );
}
