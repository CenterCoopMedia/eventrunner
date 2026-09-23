// Admin access (issue #187) — who may sign in to the admin panel, and at
// which tier. Operator-only: the docket entry declares it (AdminLayout.jsx),
// and the two endpoints behind it (functions/src/admin/access.cjs
// listAdminAccess / setAdminAccess) refuse anyone else.
//
// `config/bootstrap` is server-only in both directions, so there is no live
// listener here: a plain fetch on mount and after every accepted change, the
// same shape AdminSystemErrors takes for its server-only rows. A first load
// that fails is an error state with one retry, never an empty list: an
// empty list would say "nobody has access", which is not what happened. The
// retry control stays mounted and busy while it runs, so the keyboard stays
// on it; when the list it asked for lands, focus moves to the table.
//
// THE GALLEY, AS A TABLE. One ruled table of accounts: the address in the
// data face, the tier as a word in a badge, and the row's quiet actions as
// link-coloured words at the trailing end. No tiles, no zebra, no row cards.
// The signed-in operator's own row says so in words, because an operator
// about to remove an account should be able to see at a glance that it is
// their own.
//
// EVERY CHANGE ASKS FIRST. A grant, a tier change, and a removal each open
// the same still surface under the grant form, above the table (the
// DestructiveConfirm device, drawn here so the row's trigger can stay a
// quiet word and so focus can be managed): a sentence naming what changes
// for whom, a confirm button that repeats the consequence, and Cancel. A
// removal sits on the alarm ground; a grant or a tier change on the proof
// ground, because widening or narrowing access is deliberate but not
// destructive. A grant to an address that already holds that tier is said
// in place and opens nothing.
//
// FOCUS FOLLOWS THE SURFACE. Onto it when it opens — and only then: a list
// that lands while it is open changes nothing about where the keyboard is.
// When it closes — after a confirmed change or a cancel — back to the
// control that opened it, or, if that control's row is gone, to the grant
// field. After a refusal, onto the refusal itself. Every move happens in an
// effect AFTER the render that mounts or unmounts the element, because a
// focus call made in the async continuation lands on a node React is about
// to remove and drops to the body.
//
// The server's refusal is shown verbatim and in place — "At least one
// operator must keep access." names the rule an operator just met — and it
// stays until the next attempt. Addresses are lowercased on write by the
// server; the form lowercases as it goes so the list and the field agree.
// Each tier's sections are named in TIER_SCOPE, in the rail's own words,
// so the description, the confirmation sentences and the shell's refusal
// cannot drift apart.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { TIER_SCOPE } from '../AdminLayout.jsx';
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The words a pending change is stated in: the heading, the sentence
 * naming the consequence, and the confirm label that repeats it.
 *
 * `previousTier` is the account's standing now: 'operator' or 'staff', null
 * for an address not yet listed, or undefined when the list did not load
 * and the standing is unknown — then the sentence says only what will be
 * true afterwards, and claims nothing about what is lost.
 *
 * @param {{ email: string, tier: 'operator'|'staff'|'none',
 *           previousTier: 'operator'|'staff'|null|undefined }} change
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
  const word = TIER_WORDS[tier].label.toLowerCase();
  if (previousTier === undefined) {
    return {
      title: `Set ${word} access for ${email}`,
      consequence: tier === 'operator'
        ? `${email} will have operator access to the admin panel at once and can open every section, including ${TIER_SCOPE.operatorOnly}.`
        : `${email} will have staff access to the admin panel at once and can run ${TIER_SCOPE.staff}.`,
      confirmLabel: `Set ${word} access`,
      destructive: false,
    };
  }
  if (previousTier === null) {
    return tier === 'operator'
      ? {
        title: `Grant operator access to ${email}`,
        consequence: `${email} can sign in to the admin panel at once and open every section, including ${TIER_SCOPE.operatorOnly}. An operator can change who has access, including yours.`,
        confirmLabel: 'Grant operator access',
        destructive: false,
      }
      : {
        title: `Grant staff access to ${email}`,
        consequence: `${email} can sign in to the admin panel at once and run ${TIER_SCOPE.staff}. Staff cannot open ${TIER_SCOPE.operatorOnly}.`,
        confirmLabel: 'Grant staff access',
        destructive: false,
      };
  }
  return tier === 'operator'
    ? {
      title: `Change ${email} to operator`,
      consequence: `${email} gains ${TIER_SCOPE.operatorOnly}. An operator can change who has access, including yours.`,
      confirmLabel: 'Change to operator',
      destructive: false,
    }
    : {
      title: `Change ${email} to staff`,
      consequence: `${email} loses ${TIER_SCOPE.operatorOnly} and keeps ${TIER_SCOPE.staff}.`,
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
 * The still surface a pending change is confirmed on. The page owns the
 * focus moves; this only exposes the two elements they land on.
 */
function ChangeConfirm({ change, busy, error, onConfirm, onCancel, surfaceRef, errorRef }) {
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
      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <Notice tone="error" message={error} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-xs">
        <button
          type="button"
          className={words.destructive ? dangerButtonClass : primaryButtonClass}
          disabled={busy}
          aria-busy={busy || undefined}
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

  // null until the first load answers; then the list, even when a LATER
  // reload fails (those keep the last values and say so).
  const [accounts, setAccounts] = useState(null);
  const [callerEmail, setCallerEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ email: '', tier: 'staff' });
  const [formError, setFormError] = useState(null);
  // The one change awaiting confirmation, or null.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [changeError, setChangeError] = useState(null);
  const [result, setResult] = useState(null);
  const surfaceRef = useRef(null);
  const errorRef = useRef(null);
  const formRef = useRef(null);
  // The control that opened the surface, and whether the next close should
  // hand focus back to it. Both are read by the focus effect, never by the
  // async continuation that closes the surface.
  const triggerRef = useRef(null);
  const returnFocusRef = useRef(false);
  // Whether the next list to land should take focus: "Try again" asks for
  // it, because that control leaves the page the moment the list arrives.
  const focusListRef = useRef(false);
  const listRef = useRef(null);

  const load = useCallback(async ({ focusList = false } = {}) => {
    setLoading(true);
    try {
      const response = await call('listAdminAccess', {});
      focusListRef.current = focusList;
      setAccounts(Array.isArray(response?.accounts) ? response.accounts : []);
      setCallerEmail(typeof response?.callerEmail === 'string' ? response.callerEmail : null);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  // Focus follows the surface (see the file comment). Runs after the render
  // that mounted or unmounted it, so the node it lands on exists — and only
  // when the pending change itself moves (opens, closes, or is replaced by
  // another), never because the list behind it reloaded.
  useEffect(() => {
    if (pending) {
      surfaceRef.current?.focus();
      return;
    }
    if (!returnFocusRef.current) return;
    returnFocusRef.current = false;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && trigger.isConnected) trigger.focus();
    else formRef.current?.querySelector('input')?.focus();
  }, [pending]);

  // The list "Try again" asked for has landed: the keyboard was on that
  // control, which is gone now, so it goes to what was asked for.
  useEffect(() => {
    if (accounts === null || !focusListRef.current) return;
    focusListRef.current = false;
    listRef.current?.focus();
  }, [accounts]);

  // A refusal is read where it lands, not from wherever the disabled confirm
  // button dropped the keyboard.
  useEffect(() => {
    if (changeError) errorRef.current?.focus();
  }, [changeError]);

  function open(change, trigger) {
    setResult(null);
    setChangeError(null);
    triggerRef.current = trigger ?? null;
    setPending(change);
  }

  function close() {
    returnFocusRef.current = true;
    setChangeError(null);
    setPending(null);
  }

  function submitGrant(event) {
    event.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setFormError('Enter an email address.');
      // After the render that marks the field, not before it.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    setFormError(null);
    const existing = accounts ? accounts.find((account) => account.email === email) : undefined;
    if (existing && existing.tier === form.tier) {
      // Nothing would change, so nothing is asked.
      setResult({
        tone: 'info',
        message: `${email} already has ${TIER_WORDS[form.tier].label.toLowerCase()} access.`,
      });
      return;
    }
    open(
      { email, tier: form.tier, previousTier: accounts ? existing?.tier ?? null : undefined },
      event.currentTarget.querySelector('button[type="submit"]'),
    );
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setChangeError(null);
    const { email, tier, previousTier } = pending;
    try {
      const response = await call('setAdminAccess', { email, tier });
      const nextTier = response?.tier ?? (tier === 'none' ? null : tier);
      const standing = previousTier === undefined ? response?.previousTier ?? null : previousTier;
      const sentence = response?.changed === false
        ? `${email} already had this access.`
        : describeResult({ email, tier: nextTier, previousTier: standing });
      // The line on the page is the record and it announces; the bar
      // repeats it silently.
      setResult({ tone: 'ok', message: sentence });
      showToast(sentence, { announce: false });
      if (standing === null && tier !== 'none') setForm({ email: '', tier: 'staff' });
      await load();
      close();
    } catch (err) {
      // Verbatim and in place: the server's sentence names the rule.
      setChangeError(err.message);
      showToast(err.message, { tone: 'error', announce: false });
    } finally {
      setBusy(false);
    }
  }

  const operatorCount = (accounts ?? []).filter((account) => account.tier === 'operator').length;

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Access"
        identifiers={
          accounts
            ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}, ${operatorCount} operator${operatorCount === 1 ? '' : 's'}`
            : undefined
        }
        description={`Who can sign in to the admin panel, and at which tier. Operators open every section, including ${TIER_SCOPE.operatorOnly}. Staff run ${TIER_SCOPE.staff}. Every change here asks you to confirm it first and is recorded in the admin log.`}
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
          errorRef={errorRef}
        />
      ) : null}

      {result ? <Notice tone={result.tone} message={result.message} /> : null}

      {accounts === null && loading && !loadError ? (
        <AdminLoadingState label="Loading access…" />
      ) : accounts === null ? (
        <div className="flex flex-col gap-xs">
          <Notice
            tone="error"
            message={`The access list could not be loaded${loadError?.message ? `: ${loadError.message}` : '.'}`}
          />
          <div>
            {/* The same control through the retry: busy, not gone, so the
                keyboard stays on it whether the retry lands or fails. */}
            <button
              type="button"
              className={secondaryButtonClass}
              aria-busy={loading || undefined}
              onClick={() => {
                if (!loading) load({ focusList: true });
              }}
            >
              {loading ? 'Loading…' : 'Try again'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {loadError ? (
            <Notice
              tone="caution"
              message="We could not refresh the access list; showing the last values we received."
            />
          ) : null}
          {accounts.length === 0 ? (
            <AdminEmptyState
              title="No admin accounts"
              description="Nobody is listed. Grant access above."
            />
          ) : (
            <Panel flush>
              <table ref={listRef} tabIndex={-1} className="w-full border-collapse text-admin-sm">
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
                          <span className="break-all font-admin-data text-admin-base text-admin-ink">
                            {account.email}
                          </span>
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
        </>
      )}
    </div>
  );
}
