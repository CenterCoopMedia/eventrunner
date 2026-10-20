// A representative's own organization (issue #334), /profile/organization.
//
// Staff give an account access to one organization. This page edits the
// three fields a representative may change: the short description, the
// longer text about the organization, and the website. A save does not
// change the public page: it goes to the event team for review, and the
// public page changes when they publish it
// (functions/src/cms/organizationRepresentatives.cjs).
//
// The page asks the server for "my organization" and never names one, so
// there is nothing here to point at another organization. The name, the
// logo, the tier and the order are the event team's, and the page shows
// the name and the logo for orientation only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import AssetImage from '../components/media/AssetImage.jsx';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { inputClass, primaryActionClass } from '../components/controlClasses.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { getOwnOrganization, submitOrganizationEdit } from '../lib/organizationProfileApi.js';
import {
  REPRESENTATIVE_LIMITS,
  representativeFields,
  validateRepresentativeForm,
} from '../lib/organizationProfileForm.js';

const FIELDS = [
  {
    id: 'description',
    label: 'Short description',
    hint: 'One or two sentences. They show under your name on the sponsors page and on your own page.',
    rows: 3,
  },
  {
    id: 'bio',
    label: 'About your organization',
    hint: 'A longer introduction for your own page. Leave a blank line between paragraphs.',
    rows: 8,
  },
  { id: 'url', label: 'Website', hint: 'Starts with http:// or https://.', type: 'url' },
];

const PENDING_NOTE =
  'Your changes are waiting for review. Your public page shows the earlier text until the event team publishes them.';

const text = (value) => (typeof value === 'string' ? value : '');

function formFrom(view) {
  const effective = { ...(view.organization ?? {}), ...(view.pending?.fields ?? {}) };
  return { description: text(effective.description), bio: text(effective.bio), url: text(effective.url) };
}

export default function OrganizationProfile() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [load, setLoad] = useState({ status: 'loading', view: null, error: null });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState(() => new Map());
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);
  const alertRef = useRef(null);
  // A response applies only while it is still the newest request, so a
  // sign-out and a different sign-in on the same page never mix.
  const requestIdRef = useRef(0);
  useDocumentTitle('Your organization');

  const loadOrganization = useCallback(() => {
    if (!user) return;
    const requestId = ++requestIdRef.current;
    setLoad({ status: 'loading', view: null, error: null });
    getOwnOrganization({ user })
      .then((view) => {
        if (requestIdRef.current !== requestId) return;
        setLoad({ status: 'ready', view, error: null });
        setForm(formFrom(view));
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setLoad({ status: err?.code === 'not-representative' ? 'denied' : 'error', view: null, error: err });
      });
  }, [user]);

  useEffect(() => {
    loadOrganization();
  }, [loadOrganization]);

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  if (!user) {
    return (
      <article className="mx-auto max-w-md">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">Sign in to edit your organization</h1>
        <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">
          Use the address the event team gave access to.
        </p>
        <div className="mt-lg">
          <SignInPanel />
        </div>
      </article>
    );
  }

  if (load.status === 'denied') {
    return (
      <EmptyState
        title="This account does not represent an organization"
        description="The event team gives access to one account for each organization. Ask them to add the address you signed in with."
        action={<Link to="/profile" className={primaryActionClass}>Go to your account</Link>}
      />
    );
  }

  if (load.status === 'error') {
    return (
      <EmptyState
        title="Your organization could not be loaded"
        description={load.error?.message || 'Try again in a moment.'}
        action={<button type="button" onClick={loadOrganization} className={primaryActionClass}>Try again</button>}
      />
    );
  }

  if (load.status === 'loading' || !form) {
    return (
      <div className="mt-lg">
        <LoadingState label="Loading your organization…" />
      </div>
    );
  }

  const { organizationId, organization, pending } = load.view;
  if (!organization) {
    return (
      <EmptyState
        title="Your organization is not on the site yet"
        description="You can edit its profile once the event team publishes it."
        action={<Link to="/profile" className={primaryActionClass}>Go to your account</Link>}
      />
    );
  }

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors.has(field)) {
      setErrors((current) => {
        const next = new Map(current);
        next.delete(field);
        return next;
      });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;
    const found = validateRepresentativeForm(form);
    setErrors(found);
    if (found.size > 0) {
      const first = FIELDS.find((field) => found.has(field.id));
      formRef.current?.querySelector(`#organization-${first.id}`)?.focus();
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const result = await submitOrganizationEdit({ user, fields: representativeFields(form) });
      setLoad((current) => ({ ...current, view: { ...current.view, pending: result?.pending ?? null } }));
      showToast(result?.pending
        ? 'Changes sent. The event team reviews them before they appear.'
        : 'No changes to send. Your public page already shows this text.');
    } catch (err) {
      setServerError(err);
      const marked = new Map();
      for (const entry of err?.fieldErrors ?? []) {
        if (FIELDS.some((field) => field.id === entry.field) && !marked.has(entry.field)) {
          marked.set(entry.field, entry.message);
        }
      }
      if (marked.size > 0) setErrors(marked);
    } finally {
      setSaving(false);
    }
  };

  const serverMessages = serverError
    ? (serverError.fieldErrors?.length ? serverError.fieldErrors.map((entry) => entry.message) : [serverError.message])
    : [];

  return (
    <article className="mx-auto max-w-2xl">
      {organization.logoPath ? (
        <div className="mb-lg max-w-xs">
          <AssetImage path={organization.logoPath} alt="" decorative className="max-h-24 w-auto object-contain" />
        </div>
      ) : null}
      <h1 className="font-heading text-h1 font-semibold text-text-primary">{organization.name || organizationId}</h1>
      <p className="mt-xs max-w-prose text-body text-text-secondary">
        You represent this organization. The event team reviews your changes before they appear on your public page.
        They keep the name, the logo, and the place on the sponsors page.
      </p>
      <p className="mt-xs">
        <Link to={`/sponsors/${encodeURIComponent(organizationId)}`} className="font-data text-caption text-text-primary underline">
          See your public page
        </Link>
      </p>
      {pending ? (
        <p role="status" className="mt-md border-hairline border-warning/40 bg-warning/10 px-sm py-xs font-data text-caption text-warning">
          {PENDING_NOTE}
        </p>
      ) : null}
      {serverMessages.length > 0 ? (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="mt-md border-hairline border-danger/40 bg-danger/10 px-sm py-xs font-data text-caption text-danger"
        >
          {serverMessages.map((message) => <p key={message}>{message}</p>)}
        </div>
      ) : null}

      <form ref={formRef} className="mt-xl space-y-lg" onSubmit={handleSubmit} noValidate>
        {FIELDS.map((field) => {
          const id = `organization-${field.id}`;
          const error = errors.get(field.id);
          const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');
          const shared = {
            id,
            className: `mt-2xs ${inputClass}`,
            value: form[field.id],
            onChange: (event) => setField(field.id, event.target.value),
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': describedBy,
          };
          return (
            <div key={field.id}>
              <label htmlFor={id} className="block font-semibold text-text-primary">{field.label}</label>
              <p id={`${id}-hint`} className="mt-3xs font-data text-caption text-text-secondary">
                {field.hint} Up to {REPRESENTATIVE_LIMITS[field.id]} characters.
              </p>
              {field.rows ? (
                <textarea {...shared} rows={field.rows} />
              ) : (
                <input {...shared} type={field.type} inputMode="url" autoComplete="url" spellCheck={false} />
              )}
              {error ? (
                <p id={`${id}-error`} className="mt-3xs font-data text-caption text-danger">{error}</p>
              ) : null}
            </div>
          );
        })}
        <button type="submit" className={primaryActionClass} aria-busy={saving || undefined}>
          {saving ? 'Sending…' : 'Send for review'}
        </button>
      </form>
    </article>
  );
}
