// The promo code field on the ticket review step (ADR 0004 amendment
// 2026-11-04). The server prices the code; this only asks for a preview to
// show the lower total. The reservation checks the code again.
import { useState } from 'react';
import { ticketingRequest } from '../../lib/ticketingCommerce.js';
import { secondaryActionClass } from '../controlClasses.js';
import { TextField } from '../forms/publicForm.jsx';

/**
 * @param {{ user: object, cart: { ticketTypeId: string, quantity: number }[], catalogRevision: number,
 *   applied: object|null, refusal: string, onApplied: (preview: object|null) => void }} props
 *   `refusal` is a message from a refused checkout, shown like a refused preview.
 */
export default function PromoCodeField({ user, cart, catalogRevision, applied, refusal, onApplied }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A checkout refusal shows until the buyer types another code.
  const shown = error || (code ? '' : refusal);

  async function apply() {
    if (busy) return;
    if (!code.trim()) { setError('Enter a promo code.'); return; }
    setBusy(true);
    setError('');
    try {
      const preview = await ticketingRequest('ticketingPromoPreview', { user, body: { code: code.trim(), catalogRevision, lines: cart } });
      onApplied(preview);
      setCode('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <div className="flex flex-wrap items-center gap-sm">
        <p>Promo code <span className="font-data font-semibold">{applied.code}</span> is applied.</p>
        <button type="button" className={secondaryActionClass} onClick={() => onApplied(null)}>Remove code</button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-sm">
      <div className="min-w-0 grow">
        <TextField
          label="Promo code" value={code} error={shown || undefined} autoComplete="off" autoCapitalize="characters" maxLength={32}
          onChange={(value) => { setCode(value); setError(''); }}
          // Enter applies the code. The review form's own submit is Pay.
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
        />
      </div>
      <button type="button" className={secondaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={apply}>{busy ? 'Checking code…' : 'Apply code'}</button>
    </div>
  );
}
