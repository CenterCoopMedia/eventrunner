// Organization representatives in the organization editor (issue #334).
//
//   Edit waiting for review  what a representative sent, beside the text
//                            in the draft now. Apply writes it into the
//                            draft (staff then publish as usual); discard
//                            removes it.
//   Representatives          the accounts that may edit this organization's
//                            profile. Add one by its sign-in address, or
//                            remove one.
//
// Both call the staff-tier organizationRepresentatives endpoint
// (functions/src/cms/organizationRepresentatives.cjs), which writes the
// admin log row. The editor renders this outside its own form, so the
// address field here never submits the organization.
import { useId, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';

const ENDPOINT = 'organizationRepresentatives';

/** The editor's words for the fields a representative may change. */
export const REPRESENTATIVE_FIELD_LABELS = Object.freeze({
  description: 'Description',
  bio: 'About',
  url: 'Website',
});

const SIGN_IN_PATH = '/profile/organization';

function dateOf(value) {
  const date = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null;
}

function shown(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function FieldText({ value, empty }) {
  const text = shown(value);
  return text
    ? <span className="whitespace-pre-line wrap-anywhere text-admin-ink">{text}</span>
    : <span className="text-admin-ink-secondary">{empty}</span>;
}

function EditReview({ organizationId, request, current, isUnsaved, onApplied, onResult }) {
  const call = useAdminApi();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const fields = Object.keys(request.fields ?? {}).filter((field) => field in REPRESENTATIVE_FIELD_LABELS);
  const unsaved = fields.filter((field) => isUnsaved(field)).map((field) => REPRESENTATIVE_FIELD_LABELS[field]);
  const sender = request.submittedByEmail || 'a representative';
  const sentAt = dateOf(request.submittedAt);

  async function apply(overwrite = false) {
    if (busy || unsaved.length > 0) return;
    setBusy('apply');
    setError(null);
    try {
      const result = await call(ENDPOINT, { action: 'apply', organizationId, ...(overwrite ? { overwrite: true } : {}) });
      // What the server wrote, not this page's copy of the edit: a retried
      // apply reads the queue again and can write a newer edit.
      const applied = result?.applied && typeof result.applied === 'object' ? result.applied : {};
      onApplied(Object.fromEntries(
        Object.entries(applied).filter(([field]) => field in REPRESENTATIVE_FIELD_LABELS),
      ));
      onResult({ tone: 'ok', message: 'Edit applied to the draft. Publish to show it on the site.' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy('discard');
    setError(null);
    try {
      await call(ENDPOINT, { action: 'discard', organizationId });
      onResult({ tone: 'ok', message: 'Edit discarded. The organization did not change.' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="region" aria-label="Edit waiting for review">
      <Panel
        title="Edit waiting for review"
        description={`From ${sender}${sentAt ? `, ${sentAt}` : ''}. Apply copies it into the draft. It reaches the site when you publish.`}
      >
        <dl className="flex flex-col gap-sm">
          {fields.map((field) => (
            <div key={field} className="grid gap-2xs border-b-admin-hairline border-admin-rule-hairline pb-sm last:border-b-0 sm:grid-cols-[8rem_1fr_1fr]">
              <dt className="text-admin-sm font-semibold text-admin-ink">{REPRESENTATIVE_FIELD_LABELS[field]}</dt>
              <dd className="text-admin-sm">
                <span className="block text-admin-xs text-admin-ink-secondary">In the draft now</span>
                <FieldText value={current?.[field]} empty="Empty" />
              </dd>
              <dd className="text-admin-sm">
                <span className="block text-admin-xs text-admin-ink-secondary">Proposed</span>
                <FieldText value={request.fields[field]} empty="Empty. Apply clears the field." />
              </dd>
            </div>
          ))}
        </dl>
        {unsaved.length > 0 ? (
          <p className="mt-sm text-admin-sm text-admin-state-caution">
            Save or undo your changes to {unsaved.join(' and ')} first.
          </p>
        ) : null}
        {error ? (
          <div className="mt-sm">
            <Notice tone="error" message={error.message} />
            {error.code === 'staff-changed' ? (
              <button
                type="button"
                className={`${secondaryButtonClass} mt-xs`}
                onClick={() => apply(true)}
                aria-busy={busy === 'apply' || undefined}
              >
                Apply and replace staff text
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="mt-sm flex flex-wrap items-center gap-xs">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => apply(false)}
            disabled={unsaved.length > 0}
            aria-busy={busy === 'apply' || undefined}
          >
            {busy === 'apply' ? 'Applying…' : 'Apply to draft'}
          </button>
          <DestructiveConfirm
            trigger="Discard this edit"
            title={`Discard the edit from ${sender}`}
            confirmLabel="Discard this edit"
            busyLabel="Discarding…"
            busy={busy === 'discard'}
            consequence="The edit is removed and the organization does not change. The representative keeps access and can send a new edit."
            permanence="This cannot be undone."
            onConfirm={discard}
          />
        </div>
      </Panel>
    </div>
  );
}

function RepresentativeList({ organizationId, grants, request, onResult }) {
  const call = useAdminApi();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState(null);
  const formId = useId();

  async function add(event) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) {
      setFieldError('Enter the address the person signs in with.');
      return;
    }
    setBusy('add');
    setFieldError(null);
    setError(null);
    try {
      const result = await call(ENDPOINT, { action: 'grant', organizationId, email: address });
      setEmail('');
      onResult({
        tone: 'ok',
        message: result?.changed === false
          ? 'This account already represents this organization.'
          : `Representative added. They edit at ${SIGN_IN_PATH}.`,
        where: 'representatives',
      });
    } catch (err) {
      const segment = err?.fieldErrors?.find((entry) => entry.field === 'email');
      if (segment) setFieldError(segment.message);
      else setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function remove(grant) {
    setBusy(grant.id);
    setError(null);
    try {
      await call(ENDPOINT, { action: 'revoke', uid: grant.uid ?? grant.id });
      onResult({ tone: 'ok', message: `${grant.email ?? 'The account'} can no longer edit this organization.`, where: 'representatives' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error ? <Notice tone="error" message={error.message} /> : null}
      {grants.length === 0 ? (
        <p className="text-admin-sm text-admin-ink-secondary">No representatives yet.</p>
      ) : (
        <ul className="flex flex-col">
          {grants.map((grant) => (
            <li key={grant.id} className="flex flex-wrap items-center justify-between gap-xs border-b-admin-hairline border-admin-rule-hairline py-xs last:border-b-0">
              <span className="wrap-anywhere font-admin-data text-admin-sm text-admin-ink">{grant.email ?? grant.id}</span>
              <DestructiveConfirm
                trigger={`Remove ${grant.email ?? grant.id}`}
                confirmLabel="Remove access"
                busyLabel="Removing…"
                busy={busy === grant.id}
                consequence={`This account can no longer edit this organization.${
                  request?.submittedByUid === (grant.uid ?? grant.id) ? ' Their edit waiting for review is discarded.' : ''
                } The organization's page does not change.`}
                onConfirm={() => remove(grant)}
              />
            </li>
          ))}
        </ul>
      )}
      <form id={formId} className="mt-sm flex flex-wrap items-end gap-xs" onSubmit={add} noValidate>
        <div className="min-w-[16rem] flex-1">
          <TextField
            label="Account address"
            hint="The address they sign in with. They must have signed in to the site once."
            type="email"
            autoComplete="off"
            value={email}
            onChange={(value) => { setEmail(value); setFieldError(null); }}
            error={fieldError}
          />
        </div>
        <button type="submit" className={secondaryButtonClass} aria-busy={busy === 'add' || undefined}>
          {busy === 'add' ? 'Adding…' : 'Add representative'}
        </button>
      </form>
    </>
  );
}

/**
 * @param {{ organizationId: string, current: object|null, grants: object[], request: object|null,
 *           listenerError: unknown, isUnsaved: (field: string) => boolean,
 *           onApplied: (fields: object) => void }} props
 */
export default function OrganizationRepresentatives({
  organizationId, current, grants, request, listenerError, isUnsaved, onApplied,
}) {
  const { showToast } = useToast();
  const [result, setResult] = useState(null);

  const report = (next) => {
    setResult(next);
    showToast(next.message, { announce: false });
  };

  return (
    <div className="flex flex-col gap-md">
      {listenerError ? (
        <Notice
          tone="caution"
          message="We lost the connection to the representatives and their edits; showing the last values we received and retrying."
        />
      ) : null}
      {result && result.where !== 'representatives' ? <Notice tone={result.tone} message={result.message} /> : null}
      {request ? (
        <EditReview
          organizationId={organizationId}
          request={request}
          current={current}
          isUnsaved={isUnsaved}
          onApplied={onApplied}
          onResult={report}
        />
      ) : null}
      <div role="region" aria-label="Representatives">
        <Panel
          title="Representatives"
          description={`A representative edits the description, the about text, and the website at ${SIGN_IN_PATH}. Each edit waits here for your review. The name, logo, tier, order, and visibility stay with staff.`}
        >
          {result && result.where === 'representatives' ? (
            <div className="mb-sm"><Notice tone={result.tone} message={result.message} /></div>
          ) : null}
          <RepresentativeList organizationId={organizationId} grants={grants} request={request} onResult={report} />
        </Panel>
      </div>
    </div>
  );
}
