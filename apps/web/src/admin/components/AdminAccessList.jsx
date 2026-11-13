import { Panel, secondaryButtonClass } from './formControls.jsx';
import { StatusBadge } from './adminChrome.jsx';
import AdminIconControl from './AdminIconControl.jsx';
import AdminTableScroll from './AdminTableScroll.jsx';

/** The tier word and its badge tone. The word is always rendered; the tone agrees with it. */
export const TIER_WORDS = Object.freeze({
  operator: { label: 'Operator', tone: 'info' },
  staff: { label: 'Staff', tone: 'neutral' },
});

const END_TIME_FORMAT = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/**
 * An end time as people read it, in the browser's own time zone and with
 * the zone named, so an operator in one zone and a reader in another do
 * not read the same words as two times.
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatEndTime(iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return 'an unreadable time';
  return new Intl.DateTimeFormat(undefined, END_TIME_FORMAT).format(new Date(ms));
}

/** Whether an account row holds a staff grant with an end time (readable or not). */
export function isTemporary(account) {
  return Boolean(account) && account.tier === 'staff' && typeof account.expiryState === 'string';
}

/**
 * The words under the tier badge for a staff grant with an end time. The
 * server decided the state by its own clock.
 */
function EndTimeLine({ account }) {
  if (!isTemporary(account)) return null;
  const text = account.expiryState === 'active'
    ? `Access ends ${formatEndTime(account.expiresAt)}.`
    : account.expiryState === 'expired'
      ? `Access ended ${formatEndTime(account.expiresAt)}. No access now.`
      : 'The end time cannot be read. No access now.';
  return <p className="mt-3xs text-admin-xs text-admin-ink-secondary">{text}</p>;
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

/** The account table; its controller owns changes, confirmations and focus. */
export default function AdminAccessList({ accounts, callerEmail, busy, onOpen, listRef }) {
  return (
  <Panel flush>
    <AdminTableScroll role="region" aria-label="Admin accounts and their roles" tabIndex={0} className="overflow-auto rounded-admin-panel">
    <table ref={listRef} tabIndex={-1} className="w-full min-w-[52rem] border-collapse text-admin-sm">
      <caption className="sr-only">Admin accounts and their roles</caption>
      <thead>
        <tr>
          <GalleyHead>Account</GalleyHead>
          <GalleyHead>Role</GalleyHead>
          <GalleyHead align="end">Actions</GalleyHead>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => {
          const isSelf = account.email === callerEmail;
          const word = TIER_WORDS[account.tier] ?? { label: 'Team member', tone: 'neutral' };
          const otherTier = account.tier === 'operator' ? 'staff' : 'operator';
          return (
            <tr
              key={account.email}
              className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0"
            >
              <td className="px-md py-sm align-top">
                <span className="whitespace-nowrap font-admin-data text-admin-base text-admin-ink">
                  {account.email}
                </span>
                {isSelf ? (
                  <span className="ms-xs text-admin-xs text-admin-ink-secondary">(you)</span>
                ) : null}
                {account.support ? (
                  <span className="ms-xs text-admin-xs text-admin-ink-secondary">CCM support</span>
                ) : null}
              </td>
              <td className="px-md py-sm align-top">
                <StatusBadge tone={word.tone}>{word.label}</StatusBadge>
                {isTemporary(account) && account.expiryState !== 'active' ? (
                  <StatusBadge tone="caution" className="ms-xs">
                    {account.expiryState === 'expired' ? 'Ended' : 'No access'}
                  </StatusBadge>
                ) : null}
                <EndTimeLine account={account} />
              </td>
              <td className="px-md py-sm text-end align-top">
                <div className="flex flex-wrap items-center justify-end gap-xs">
                  <AdminIconControl
                    icon="edit"
                    label={`Change ${account.email} to ${TIER_WORDS[otherTier].label.toLowerCase()}`}
                    disabled={busy}
                    onClick={(event) => onOpen(
                      {
                        email: account.email,
                        tier: otherTier,
                        previousTier: account.tier,
                        previousTemporary: isTemporary(account),
                      },
                      event.currentTarget,
                    )}
                  />
                  <AdminIconControl
                    icon="remove"
                    label={`Remove access for ${account.email}`}
                    className="text-admin-state-error"
                    disabled={busy}
                    onClick={(event) => onOpen(
                      { email: account.email, tier: 'none', previousTier: account.tier },
                      event.currentTarget,
                    )}
                  />
                  {!isTemporary(account) || account.expiryState === 'active' ? (
                    <button
                      type="button"
                      className={`${secondaryButtonClass} whitespace-nowrap`}
                      aria-label={`Send sign-in instructions to ${account.email}`}
                      disabled={busy}
                      onClick={(event) => onOpen({ email: account.email, action: 'resend' }, event.currentTarget)}
                    >
                      Send sign-in instructions
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </AdminTableScroll>
  </Panel>
  );
}

