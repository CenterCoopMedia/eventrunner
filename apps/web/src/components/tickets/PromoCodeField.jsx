// The promo code field on the ticket review step (ADR 0004 amendment
// 2026-11-04). The server prices the code; this only asks for a preview to
// show the lower total. The reservation checks the code again.
import { PublicLink as Link } from '../PublicLink.jsx';
import { secondaryActionClass } from '../controlClasses.js';
import { TextField } from '../forms/publicForm.jsx';

export default function PromoCodeField({ code, applied, error, busy, unknown, onChange, onApply, onRemove, onContinueWithoutPromo }) {
  if (applied) {
    return (
      <div className="flex flex-wrap items-center gap-sm">
        <p>Promo code <span className="font-data font-semibold">{applied.code}</span> is applied.</p>
        <button type="button" className={secondaryActionClass} onClick={onRemove}>Remove code</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-sm">
      <div className="min-w-0 grow">
        <TextField
          label="Promo code" value={code} error={error || undefined} readOnly={busy || unknown} autoComplete="off" autoCapitalize="characters" maxLength={32}
          onChange={onChange}
          // Enter applies the code. The review form's own submit is Pay.
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (!busy && !unknown) onApply(); } }}
        />
      </div>
      {unknown ? (
        <div className="w-full space-y-xs">
          <p role="status">We don’t know whether the promo code applies. The code check doesn’t place an order.</p>
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryActionClass} onClick={onContinueWithoutPromo}>Continue without a promo code</button>
            <Link to="/tickets/status" target="_blank" rel="noopener" className={secondaryActionClass}>Check my order (opens in a new tab)</Link>
          </div>
        </div>
      ) : (
        <button type="button" className={secondaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={onApply}>{busy ? 'Checking code…' : 'Apply code'}</button>
      )}
    </div>
  );
}
