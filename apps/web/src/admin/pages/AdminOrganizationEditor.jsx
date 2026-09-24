// The organization editor (issue #192): create or edit one cmsOrganizations
// record through the generic content endpoints, and publish it through
// cmsPublish like every other editor.
//
//   Save draft        → cmsCreateContent (the first save) or cmsUpdateContent
//   Save and publish  → the same save, then cmsPublish for this record
//   Delete            → cmsDeleteContent, removing live and draft together
//
// The page address is the document id, set once from the name. A form
// creates at most once: as soon as the create succeeds the page moves to
// the record's own address, and every later save from it is an update, so a
// publish that fails after a create is retried as an update rather than
// meeting the "address in use" refusal about its own record.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import {
  nextOrganizationOrder,
  organizationFields,
  organizationSlugFromName,
  tiersInUse,
  validateOrganizationForm,
} from '../organizationDoc.js';
import { useAdminOrganizations } from '../useAdminOrganizations.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { NewTabNote } from '../../components/ExternalLink.jsx';
import ImagePicker from '../components/media/ImagePicker.jsx';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';

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
  const { showToast } = useToast();
  const { rows, loading, ready, error: listenerError, findRow } = useAdminOrganizations();
  const [form, setForm] = useState(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  // The id this form created, once it has. From then on it only updates.
  const [createdId, setCreatedId] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(false);
  const orderDefaultedRef = useRef(false);
  const tierListId = useId();

  const creating = mode === 'create' && !createdId;
  const docId = mode === 'edit' ? organizationId : createdId;
  const row = docId ? findRow(docId) : null;

  // The form is filled once, and only after BOTH listeners have reported:
  // a row built before the drafts arrive is the live doc alone, and a form
  // filled from it and saved would replace the unpublished draft.
  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !ready || !row) return;
    adoptedRef.current = true;
    setForm(toForm(row));
  }, [mode, ready, row]);

  // A new organization joins the end of the wall unless the operator says
  // otherwise.
  useEffect(() => {
    if (mode !== 'create' || loading || orderDefaultedRef.current) return;
    orderDefaultedRef.current = true;
    setForm((current) => (current.order === '' ? { ...current, order: String(nextOrganizationOrder(rows)) } : current));
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
    setSaving(true);
    setError(null);
    setStatus('');
    const body = { collection: COLLECTION, fields: organizationFields(form), visible: form.visible };
    try {
      let id = docId;
      if (creating) {
        id = form.slug;
        await call('cmsCreateContent', { ...body, docId: id });
        // Created: this form never creates again, and the page moves to the
        // record's own address before the publish runs.
        adoptedRef.current = true;
        setCreatedId(id);
        navigate(`${ORGANIZATIONS_LIST}/${encodeURIComponent(id)}`, { replace: true });
      } else {
        await call('cmsUpdateContent', { ...body, docId: id });
      }
      if (publish) {
        const response = await call('cmsPublish', { collection: COLLECTION, docIds: [id] });
        const verdict = summarizePublish(response, COLLECTION, [id], 'organizations');
        if (!verdict.ok) throw new Error(verdict.message);
        setStatus(verdict.message);
        showToast(verdict.message, { announce: false });
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        showToast('Organization draft saved.', { announce: false });
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await call('cmsDeleteContent', { collection: COLLECTION, docId });
      showToast('Organization deleted.');
      navigate(ORGANIZATIONS_LIST);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && !createdId && !ready) {
    // A listener failed before both had reported. The form stays closed
    // rather than opening on one revision; the listener retries, and the
    // form opens when both are in.
    if (listenerError) {
      return (
        <Notice
          tone="caution"
          message="We could not load this organization and its saved draft. The editor opens when both have loaded, so a save cannot replace a draft it has not read. We are trying again."
        />
      );
    }
    return <AdminLoadingState label="Loading organization…" />;
  }
  if (mode === 'edit' && !createdId && !row) {
    return (
      <AdminEmptyState
        title="No such organization"
        description="That organization does not exist. It may have been deleted."
      />
    );
  }

  const tiers = tiersInUse(rows);
  const address = creating ? form.slug : docId;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-md"
      noValidate
      onSubmit={(event) => { event.preventDefault(); save(); }}
    >
      <AdminPageHeader
        title={creating ? 'New organization' : form.name || docId}
        state={!creating && row ? <RecordState state={row.state} /> : null}
        identifiers={address ? `/sponsors/${address}` : null}
        description="Save builds a draft. Preview reads that draft, and publish sends it to the sponsors page. Everything here is public once published."
        actions={
          <>
            {!creating ? (
              <a
                href={`/sponsors/${encodeURIComponent(docId)}?preview=1`}
                target="_blank"
                rel="noreferrer"
                className={linkButtonClass}
              >
                Preview draft
                <NewTabNote />
              </a>
            ) : null}
            <button
              type="submit"
              className={secondaryButtonClass}
              disabled={saving}
              aria-busy={saving || undefined}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={saving}
              aria-busy={saving || undefined}
              onClick={() => save({ publish: true })}
            >
              {saving ? 'Working…' : 'Save and publish'}
            </button>
          </>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Public details">
        <div className="flex flex-col gap-sm">
          <TextField
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
            <TextField
              label="Page address"
              hint="The end of this organization’s page address. Lowercase letters, digits, and hyphens. It cannot change after the first save."
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
          <TextAreaField
            label="Description"
            hint="One or two sentences on what this organization supports."
            rows={3}
            value={form.description}
            onChange={(value) => set('description', value)}
            error={errorFor('description')}
          />
          <TextField
            label="Website"
            type="url"
            value={form.url}
            onChange={(value) => set('url', value)}
            error={errorFor('url')}
          />
        </div>
      </Panel>

      <Panel title="Placement">
        <div className="grid gap-sm sm:grid-cols-2">
          <div>
            <TextField
              label="Tier"
              hint="Organizations with the same tier text form one group. Gold and gold are two groups."
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
          <TextField
            label="Order"
            hint="Lower numbers come first. The first tier in this order draws the largest logos."
            inputMode="decimal"
            value={form.order}
            onChange={(value) => set('order', value)}
            error={errorFor('order')}
          />
          <div className="sm:col-span-2">
            <CheckboxField
              label="Show this organization when it is published"
              checked={form.visible}
              onChange={(value) => set('visible', value)}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Logo">
        <ImagePicker
          label="Logo"
          hint="Choose the logo from the media library, or upload it there. The sponsors page shows it whole."
          folder="cms-images"
          value={form.logoPath}
          onChange={(value) => set('logoPath', value)}
          error={errorFor('logoPath')}
        />
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => navigate(ORGANIZATIONS_LIST)}>
          Cancel
        </button>
        {!creating ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this organization"
            title={`Delete ${form.name || docId}`}
            confirmLabel="Delete this organization"
            busyLabel="Deleting…"
            busy={saving}
            consequence="The live organization and its draft are removed. Its page address is free again. The logo stays in the media library."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
