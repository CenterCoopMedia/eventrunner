import { describe, expect, it } from 'vitest';
import { validateInvoiceDraft } from 'shared/invoice';
import {
  blankAdjustment,
  blankInvoiceForm,
  blankLine,
  formPathOf,
  formSnapshot,
  formToDraft,
  mintInvoiceId,
  prefillFromOrganization,
  previewTotals,
  priceFromPackage,
  sponsorPackagesFrom,
  toInvoiceForm,
} from './invoiceDoc.js';

function formWith(patch = {}) {
  return {
    ...blankInvoiceForm(),
    billTo: { name: 'Example Press', contactName: '', email: '', address: '' },
    lines: [{ ...blankLine(), description: 'Presenting package', quantity: '2', unitPrice: '2,500.00' }],
    ...patch,
  };
}

describe('invoice form', () => {
  it('turns typed money into the draft the server takes, in minor units', () => {
    const form = formWith({
      adjustments: [
        { ...blankAdjustment('discount'), label: 'Early commitment', amount: '500' },
        { ...blankAdjustment('tax'), amount: '315.00' },
      ],
    });
    const { draft, errors } = formToDraft(form, 'usd');
    expect(errors.size).toBe(0);
    expect(draft.lines).toEqual([{ description: 'Presenting package', quantity: 2, unitAmount: 250000 }]);
    expect(draft.adjustments).toEqual([
      { kind: 'discount', label: 'Early commitment', amount: 50000 },
      { kind: 'tax', label: 'Tax', amount: 31500 },
    ]);
    const verdict = validateInvoiceDraft(draft);
    expect(verdict.value.totals).toEqual({ subtotal: 500000, discountTotal: 50000, taxTotal: 31500, total: 481500 });
  });

  it('drops blank rows and marks the row staff see, not the row the server saw', () => {
    const form = formWith({
      lines: [
        blankLine(),
        { ...blankLine(), description: 'Booth', quantity: '1', unitPrice: '1.234' },
        { ...blankLine(), description: '', quantity: '1', unitPrice: '10' },
      ],
    });
    const { draft, errors, rows } = formToDraft(form, 'usd');
    expect(draft.lines).toHaveLength(2);
    expect(rows.lines).toEqual([1, 2]);
    expect(errors.get('lines.1.unitAmount')).toMatch(/2 digits/);
    expect(errors.get('lines.2.description')).toBe('Enter a description.');
    expect(formPathOf('lines.1.description', rows)).toBe('lines.2.description');
    expect(formPathOf('billTo.name', rows)).toBe('billTo.name');
    expect(formPathOf('lines', rows)).toBe('lines');
  });

  it('names a negative total only when every row parses', () => {
    const negative = formWith({ adjustments: [{ ...blankAdjustment('discount'), label: 'Too much', amount: '6000' }] });
    expect(formToDraft(negative, 'usd').errors.get('totals')).toMatch(/below zero/);
    const unparsed = formWith({ adjustments: [{ ...blankAdjustment('discount'), label: 'Too much', amount: 'lots' }] });
    expect(formToDraft(unparsed, 'usd').errors.has('totals')).toBe(false);
  });

  it('previews totals and says how many rows are not counted yet', () => {
    const form = formWith({
      lines: [
        { ...blankLine(), description: 'A', quantity: '3', unitPrice: '0.10' },
        { ...blankLine(), description: 'B', quantity: 'x', unitPrice: '5' },
        blankLine(),
      ],
      adjustments: [{ ...blankAdjustment('tax'), amount: '0.05' }],
    });
    const preview = previewTotals(form, 'usd');
    expect(preview.ok).toBe(true);
    expect(preview.lineAmounts).toEqual([30, null, null]);
    expect(preview.subtotal).toBe(30);
    expect(preview.total).toBe(35);
    expect(preview.skipped).toBe(1);
    const negative = previewTotals(formWith({ adjustments: [{ ...blankAdjustment('discount'), label: 'X', amount: '9999' }] }), 'usd');
    expect(negative.problem).toBe('negative');
  });

  it('reopens a stored invoice with the same figures', () => {
    const stored = {
      currency: 'usd',
      billTo: { organizationId: 'example-press', name: 'Example Press', contactName: '', email: '', address: '' },
      reference: 'PO-1',
      lines: [{ description: 'Package', quantity: 1, unitAmount: 123456, amount: 123456 }],
      adjustments: [{ kind: 'tax', label: 'Tax', amount: 5 }],
      dueDate: '2026-11-30',
      notes: '',
    };
    const form = toInvoiceForm(stored);
    expect(form.lines[0].unitPrice).toBe('1234.56');
    expect(form.adjustments[0].amount).toBe('0.05');
    const { draft, errors } = formToDraft(form, 'usd');
    expect(errors.size).toBe(0);
    expect(draft.lines[0].unitAmount).toBe(123456);
    expect(draft.adjustments[0].amount).toBe(5);
    expect(formSnapshot(form)).toBe(formSnapshot(toInvoiceForm(stored)));
  });

  it('mints ids the server accepts', () => {
    const id = mintInvoiceId();
    expect(id).toMatch(/^inv_[a-z0-9]{16,40}$/);
    expect(mintInvoiceId()).not.toBe(id);
  });
});

describe('organization prefill', () => {
  const rows = [
    { id: 'pkg-1', current: { blockType: 'sponsor_package', values: { name: 'Presenting', price: '$5,000 per year' } } },
    { id: 'pkg-2', current: { blockType: 'sponsor_package', values: { name: 'Coffee break', price: 'Ask us' } } },
    { id: 'other', current: { blockType: 'fact', values: { label: 'x' } } },
  ];
  const packages = sponsorPackagesFrom(rows);
  const organization = { id: 'example-press', current: { name: 'Example Press', tier: 'presenting' } };

  it('reads the sponsor packages and the first number of a price', () => {
    expect(packages).toEqual([
      { id: 'pkg-1', name: 'Presenting', price: '$5,000 per year' },
      { id: 'pkg-2', name: 'Coffee break', price: 'Ask us' },
    ]);
    expect(priceFromPackage('$5,000 per year', 'usd')).toBe('5000.00');
    expect(priceFromPackage('Ask us', 'usd')).toBe('');
  });

  it('fills the name and the package line its tier names', () => {
    const { form, filled } = prefillFromOrganization(blankInvoiceForm(), organization, packages, 'usd');
    expect(form.organizationId).toBe('example-press');
    expect(form.billTo.name).toBe('Example Press');
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0]).toMatchObject({ description: 'Presenting', quantity: '1', unitPrice: '5000.00' });
    expect(filled).toMatch(/Presenting package/);
  });

  it('keeps lines staff already wrote', () => {
    const start = formWith();
    const { form, filled } = prefillFromOrganization(start, organization, packages, 'usd');
    expect(form.lines).toBe(start.lines);
    expect(filled).toMatch(/lines are kept/);
    const noTier = prefillFromOrganization(blankInvoiceForm(), { id: 'x', current: { name: 'X' } }, packages, 'usd');
    expect(noTier.filled).toBe('Filled the name.');
    expect(prefillFromOrganization(start, null, packages, 'usd').form.organizationId).toBe('');
  });
});
