// Admin access (issue #187) — who may sign in to the admin panel, and at
// which tier. Operator-only: the docket entry declares it (AdminLayout.jsx),
// and the two endpoints behind it (functions/src/admin/access.cjs
// listAdminAccess / setAdminAccess) refuse anyone else.
//
// `config/bootstrap` is server-only in both directions, so there is no live
// listener here: a plain fetch on mount and after every accepted change, the
// same shape AdminSystemErrors takes for its server-only rows.
//
// THE GALLEY, AS A TABLE. One ruled table of accounts: the address in the
// data face, the tier as a word in a badge, and the row's quiet actions as
// link-coloured words at the trailing end. No tiles, no zebra, no row cards.
// The signed-in operator's own row says so in words, because an operator
// about to remove an account should be able to see at a glance that it is
// their own.
//
// EVERY CHANGE ASKS FIRST. A grant, a tier change, and a removal each open
// the same still surface under the table (the DestructiveConfirm device,
// drawn here so the row's trigger can stay a quiet word and so focus can be
// managed): a sentence naming what changes for whom, a confirm button that
// repeats the consequence, and Cancel. Focus moves to the surface when it
// opens and back to the control that opened it when it closes, so a
// keyboard reader is never left on an element that has gone. A removal sits
// on the alarm ground; a grant or a tier change on the proof ground, because
// widening or narrowing access is deliberate but not destructive.
//
// The server's refusal is shown verbatim and in place — "At least one
// operator must keep access." names the rule an operator just met — and it
// stays until the next attempt. Addresses are lowercased on write by the
// server; the form lowercases as it goes so the list and the field agree.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Notice,
  Panel,
  SelectField,
  TextField,
  dangerButtonClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

/** The tier word and its badge tone. The word is always rendered; the tone agrees with it. */
const TIER_WORDS = Object.freeze({
  operator: { label: 'Operator', tone: 'info' },
  staff: { label: 'Staff', tone: 'neutral' },
});

const GRANT_TIERS = [
  { value: 'staff', label: 'Staff' },
  { value: 'operator', label: 'Operator' },
];

/** What each tier may do, said once and reused by every consequence sentence. */
const OPERATOR_SECTIONS = 'Features, Branding, Access and System errors';

/**
 * The words a pending change is stated in: the heading, the sentence
 * naming the consequence, and the confirm label that repeats it.
 *
 * @param {{ email: string, tier: 'operator'|'staff'|'none', previousTier: 'operator'|'staff'|null }} change
 */
export function describeChange({ email, tier, previousTier }) {
  if (tier === 'none') {
    return {
      title: `Remove access for ${email}`,
      consequence: `${email} loses access to the admin panel at once. Everything they published stays.`,
      confirmLabel: 'Remove access',
      destructive: true,
    };
  }
  if (previousTier === null) {
    return tier === 'operator'
      ? {
        title: `Grant operator access to ${email}`,
        consequence: `${email} can sign in to the admin panel at once and open every section, including ${OPERATOR_SECTIONS}. An operator can change who has access, including yours.`,
        confirmLabel: 'Grant operator access',
        destructive: false,
      }
      : {
        title: `Grant staff access to ${email}`,
        consequence: `${email} can sign in to the admin panel at once and run the content, people and operations sections. Staff cannot open ${OPERATOR_SECTIONS}.`,
        confirmLabel: 'Grant staff access',
        destructive: false,
      };
  }
  return tier === 'operator'
    ? {
      title: `Change ${email} to operator`,
      consequence: `${email} gains ${OPERATOR_SECTIONS}. An operator can change who has access, including yours.`,
      confirmLabel: 'Change to operator',
      destructive: false,
    }
    : {
      title: `Change ${email} to staff`,
      consequence: `${email} loses ${OPERATOR_SECTIONS} and keeps the content, people and operations sections.`,
      confirmLabel: 'Change to staff',
      destructive: false,
    };
}

/** The sentence a completed change is reported in. */
export function describeResult({ email, tier, previousTier }) {
  if (tier === null || tier === 'none') return `Access removed for ${email}.`;
  if (previousTier === null) return `${TIER_WORDS[tier].label} access granted to ${email}.`;
  return `${email} is now ${TIER_WORDS[tier].label.toLowerCase()}.`;
}

/**
 * The still surface a pending change is confirmed on. `open` and `onClose`
 * belong to the page, which also owns the focus hand-back to the trigger.
 */
function ChangeConfirm({ change, busy, error, onConfirm, onCancel, surfaceRef }) {
  const headingId = useId();
  const words = describeChange(change);
  const ground = words.destructive
    ? 'border-admin-rule-alarm bg-admin-ground-alarm'
    : 'border-admin-rule-strong bg-admin-ground-proof';
  const headingInk = words.destructive ? 'text-admin-state-error' : 'text-admin-ink';
  return (
    <section
      ref={surfaceRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`flex flex-col gap-xs rounded-admin-panel border-admin-alarm px-md py-sm ${ground}`}
    >
      <h2 id={headingId} className={`text-admin-base font-bold ${headingInk}`}>
        {words.title}
      </h2>
      <p className="max-w-[65ch] text-admin-sm text-admin-ink">{words.consequence}</p>
      {error ? <Notice tone="error" message={error} /> : null}
      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          className={words.destructive ? dangerButtonClass : primaryButtonClass}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Saving…' : words.confirmLabel}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function GalleyHead({ children, align = 'start' }) {
  return (
    <th
      scope="col"
      className={`border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-md py-xs text-admin-xs font-semibold text-admin-ink-secondary ${
        align === 'end' ? 'text-end' : 'text-start'
      }`}
    >
      {children}
    </th>
  );
}

export default function AdminAccess() {
  const call = useAdminApi();
  const { showToast } = useToast();

  const [accounts, setAccounts] = useState(null);
  const [callerEmail, setCallerEmail] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ email: '', tier: 'staff' });
  const [formError, setFormError] = useState(null);
  // The one change awaiting confirmation, or null. `trigger` is the control
  // that opened it, so focus can go back there when the surface closes.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changeError, setChangeError] = useState(null);
  const [result, setResult] = useState(null);
  const surfaceRef = useRef(null);
  const formRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await call('listAdminAccess', {});
      setAccounts(Array.isArray(response?.accounts) ? response.accounts : []);
      setCallerEmail(typeof response?.callerEmail === 'string' ? response.callerEmail : null);
      setLoadError(null);
    } catch (err) {
      // Fail soft: keep the rows already shown; a failed FIRST load settles
      // the loading state on an empty list rather than loading forever.
      setLoadError(err);
      setAccounts((current) => current ?? []);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  // Focus follows the surface: onto it when it opens, back to its trigger
  // when it closes. Done after render so the element exists.
  useEffect(() => {
    if (pending) surfaceRef.current?.focus();
  }, [pending]);

  function open(change, trigger) {
    setResult(null);
    setChangeError(null);
    setPending({ ...change, trigger });
  }

  function close() {
    const trigger = pending?.trigger;
    setPending(null);
    setChangeError(null);
    // The trigger can be gone (a removed row): fall back to the grant form's
    // field, which is always there and draws its own ring, rather than to
    // the body.
    if (trigger && trigger.isConnected) trigger.focus();
    else formRef.current?.querySelector('input')?.focus();
  }

  function submitGrant(event) {
    event.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError('Enter an email address.');
      return;
    }
    setFormError(null);
    const existing = (accounts ?? []).find((account) => account.email === email);
    open({ email, tier: form.tier, previousTier: existing?.tier ?? null }, event.currentTarget.querySelector('button[type="submit"]'));
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setChangeError(null);
    const { email, tier, previousTier } = pending;
    try {
      const response = await call('setAdminAccess', { email, tier });
      const sentence = response?.changed === false
        ? `${email} already had this access.`
        : describeResult({ email, tier: response?.tier ?? (tier === 'none' ? null : tier), previousTier });
      setResult({ tone: 'ok', message: sentence });
      showToast(sentence);
      if (previousTier === null && tier !== 'none') setForm({ email: '', tier: 'staff' });
      await load();
      close();
    } catch (err) {
      // Verbatim and in place: the server's sentence names the rule.
      setChangeError(err.message);
      showToast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const operatorCount = (accounts ?? []).filter((account) => account.tier === 'operator').length;

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Access"
        identifiers={accounts ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}, ${operatorCount} operator${operatorCount === 1 ? '' : 's'}` : undefined}
        description="Who can sign in to the admin panel, and at which tier. Operators run branding, features, access and the deployment settings. Staff run content, the schedule, speakers, attendees and materials. Every change here asks you to confirm it first and is recorded in the admin log."
      />

      <Panel
        title="Grant access"
        description="Enter an address and pick a tier. The person signs in with that address the way every admin does: Google, or the emailed code."
      >
        <form ref={formRef} onSubmit={submitGrant} className="flex flex-col gap-sm" noValidate>
          <div className="flex flex-wrap items-end gap-sm">
            <div className="min-w-0 flex-1">
              <TextField
                label="Email address"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(value) => setForm((f) => ({ ...f, email: value.toLowerCase() }))}
                error={formError}
              />
            </div>
            <div className="w-full max-w-xs sm:w-auto">
              <SelectField
                label="Tier"
                value={form.tier}
                onChange={(value) => setForm((f) => ({ ...f, tier: value }))}
                options={GRANT_TIERS}
              />
            </div>
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              Grant access
            </button>
          </div>
        </form>
      </Panel>

      {pending ? (
        <ChangeConfirm
          change={pending}
          busy={busy}
          error={changeError}
          onConfirm={confirm}
          onCancel={close}
          surfaceRef={surfaceRef}
        />
      ) : null}

      {result ? <Notice tone={result.tone} message={result.message} /> : null}

      {loadError ? (
        <Notice
          tone="caution"
          message="We could not load the access list; showing the last values we received."
        />
      ) : null}

      {accounts === null ? (
        <AdminLoadingState label="Loading access…" />
      ) : accounts.length === 0 ? (
        <AdminEmptyState
          title="No admin accounts"
          description="Nobody is listed. Grant access above."
        />
      ) : (
        <Panel flush>
          <table className="w-full border-collapse text-admin-sm">
            <caption className="sr-only">Admin accounts and their tier</caption>
            <thead>
              <tr>
                <GalleyHead>Account</GalleyHead>
                <GalleyHead>Tier</GalleyHead>
                <GalleyHead align="end">Actions</GalleyHead>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const isSelf = account.email === callerEmail;
                const word = TIER_WORDS[account.tier] ?? { label: account.tier, tone: 'neutral' };
                const otherTier = account.tier === 'operator' ? 'staff' : 'operator';
                return (
                  <tr
                    key={account.email}
                    className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0"
                  >
                    <td className="px-md py-sm align-top">
                      <span className="break-all font-admin-data text-admin-base text-admin-ink">{account.email}</span>
                      {isSelf ? (
                        <span className="ms-xs text-admin-xs text-admin-ink-secondary">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-md py-sm align-top">
                      <StatusBadge tone={word.tone}>{word.label}</StatusBadge>
                    </td>
                    <td className="px-md py-sm text-end align-top">
                      <div className="flex flex-wrap items-center justify-end gap-xs">
                        <button
                          type="button"
                          className={linkButtonClass}
                          disabled={busy}
                          onClick={(event) => open(
                            { email: account.email, tier: otherTier, previousTier: account.tier },
                            event.currentTarget,
                          )}
                        >
                          Change to {TIER_WORDS[otherTier].label.toLowerCase()}
                        </button>
                        <button
                          type="button"
                          className={`${linkButtonClass} text-admin-state-error`}
                          disabled={busy}
                          onClick={(event) => open(
                            { email: account.email, tier: 'none', previousTier: account.tier },
                            event.currentTarget,
                          )}
                        >
                          Remove access
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
