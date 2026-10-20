// Invoices (issue #208): the list, the draft editor and the settings page,
// through the real App at the admin routes. The admin listeners
// (adminSource.js) and fetch are mocked, so every invoiceAdmin call is read
// off the wire the page would send.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

const adminSubscriptions = new Map();
const adminRows = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    onNext(adminRows.get(name) ?? []);
    return () => adminSubscriptions.delete(name);
  },
}));
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
const savedFiles = [];
vi.mock('../../lib/materialsSource.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlobAs: (blob, filename) => savedFiles.push({ blob, filename }),
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';
import { markTourDone } from '../tourState.js';

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

let currentPath = null;
function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}

/** invoiceAdmin answers by action; `answers[action]` is a body or a function of the request. */
let answers = {};
const invoiceCalls = () => fetch.mock.calls
  .filter(([url]) => String(url).endsWith('/invoiceAdmin'))
  .map(([, init]) => JSON.parse(init.body));

// Each test's first wait allows five seconds: it covers the lazy page chunk,
// which a cold run can take more than a second to load.
async function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
}

const SETTINGS = {
  settings: { prefix: 'INV', currency: '', issuerName: '', issuerAddress: '', issuerEmail: '', taxId: '', paymentInstructions: '' },
  revision: 0, invoiceCurrency: 'usd', catalogCurrency: null, nextNumber: 'INV-0001', canEdit: false,
};
const STORED = {
  id: 'inv_0123456789abcdef0123', status: 'draft', number: null, currency: 'usd',
  billTo: { organizationId: 'example-press', name: 'Example Press', contactName: '', email: 'billing@example.org', address: '' },
  reference: '', dueDate: '2026-11-30', notes: '',
  lines: [{ description: 'Presenting', quantity: 2, unitAmount: 250000, amount: 500000 }],
  adjustments: [{ kind: 'discount', label: 'Early', amount: 50000 }],
  totals: { subtotal: 500000, discountTotal: 50000, taxTotal: 0, total: 450000 },
  revision: 3, createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z',
};

beforeEach(() => {
  markTourDone('admin-1');
  adminSubscriptions.clear();
  adminRows.clear();
  currentPath = null;
  answers = { settings: SETTINGS, list: { invoices: [], nextCursor: null } };
  savedFiles.length = 0;
  globalThis.fetch = vi.fn(async (url, init) => {
    if (String(url).endsWith('/invoicePdf')) {
      return { ok: true, status: 200, json: async () => ({}), blob: async () => new Blob(['%PDF-'], { type: 'application/pdf' }) };
    }
    if (!String(url).endsWith('/invoiceAdmin')) return response({});
    const body = JSON.parse(init.body);
    const answer = answers[body.action];
    if (typeof answer === 'function') return answer(body);
    return response(answer ?? { error: { code: 'bad-request', message: 'Unexpected action.' } }, answer ? 200 : 400);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the invoice list', () => {
  it('shows each invoice with its status in words and its total', async () => {
    answers.list = { invoices: [STORED, { ...STORED, id: 'inv_fedcba98765432100000', status: 'paid', number: 'INV-0004' }], nextCursor: null };
    await renderAt('/admin/invoices');
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoices' }, { timeout: 5000 })).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Draft for Example Press' })).toHaveAttribute('href', `/admin/invoices/${STORED.id}`);
    expect(within(table).getByRole('link', { name: 'INV-0004' })).toBeInTheDocument();
    expect(within(table).getByText('Paid')).toHaveAttribute('data-invoice-status', 'paid');
    expect(within(table).getAllByText('$4,500.00')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 invoices.');
    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute('aria-current', 'page');
  });

  it('filters by status and searches on the server', async () => {
    await renderAt('/admin/invoices');
    expect(await screen.findByRole('heading', { name: 'No invoices yet' }, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } });
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({ action: 'list', limit: 25, status: 'paid' }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'press' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({ action: 'list', limit: 25, status: 'paid', search: 'press' }));
    expect(await screen.findByText('There are no Paid invoices that match “press”.')).toBeInTheDocument();
  });
});

describe('the invoice list pages', () => {
  const row = (index, status = 'draft') => ({
    ...STORED, id: `inv_${String(index).padStart(20, '0')}`, status,
    number: status === 'draft' ? null : `INV-${String(index).padStart(4, '0')}`,
    billTo: { ...STORED.billTo, name: `Sponsor ${index}` },
  });

  it('drops a Show more answer that arrives after the filter changed', async () => {
    let releaseOld;
    answers.list = (body) => {
      if (body.cursor === 'old-cursor') {
        return new Promise((resolve) => {
          releaseOld = () => resolve(response({ invoices: [row(9)], nextCursor: 'stale-cursor' }));
        });
      }
      if (body.status === 'paid') return response({ invoices: [row(5, 'paid')], nextCursor: null });
      return response({ invoices: [row(1)], nextCursor: 'old-cursor' });
    };
    await renderAt('/admin/invoices');
    await screen.findByRole('link', { name: 'Draft for Sponsor 1' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Show more invoices' }));
    await waitFor(() => expect(invoiceCalls().some((body) => body.cursor === 'old-cursor')).toBe(true));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paid' } });
    expect(await screen.findByRole('link', { name: 'INV-0005' })).toBeInTheDocument();
    await act(async () => releaseOld());
    expect(screen.queryByRole('link', { name: 'Draft for Sponsor 9' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Draft for Sponsor 1' })).toBeNull();
    // The new filter has no further page, and the old answer's cursor is not taken.
    expect(screen.queryByRole('button', { name: /Show more|Show older/ })).toBeNull();
  });

  it('keeps paging when a scan found no match but more invoices remain', async () => {
    answers.list = (body) => (body.cursor === 'older'
      ? response({ invoices: [row(2)], nextCursor: null })
      : response({ invoices: [], nextCursor: 'older' }));
    await renderAt('/admin/invoices?q=sponsor');
    expect(await screen.findByText(/No matches in the newest 250 invoices/, {}, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show older invoices' }));
    expect(await screen.findByRole('link', { name: 'Draft for Sponsor 2' })).toBeInTheDocument();
    expect(invoiceCalls().at(-1)).toEqual({ action: 'list', limit: 25, search: 'sponsor', cursor: 'older' });
  });
});

describe('the invoice editor', () => {
  it('fills a new draft from an organization and its package, shows live totals, and saves minor units', async () => {
    adminRows.set('cmsOrganizations', [{ id: 'example-press', name: 'Example Press', tier: 'Presenting', order: 1 }]);
    adminRows.set('cmsContent', [{ id: 'pkg', blockType: 'sponsor_package', section: 'packages', values: { name: 'Presenting', price: '$5,000' } }]);
    answers.saveDraft = (body) => response({ invoice: {
      ...STORED, id: body.invoiceId, revision: 1,
      billTo: { ...STORED.billTo, email: '' },
      lines: [{ description: 'Presenting', quantity: 2, unitAmount: 500000, amount: 1000000 }],
      adjustments: [{ kind: 'tax', label: 'Tax', amount: 1250 }],
      totals: { subtotal: 1000000, discountTotal: 0, taxTotal: 1250, total: 1001250 },
    } });
    await renderAt('/admin/invoices/new/invoice');
    expect(await screen.findByRole('heading', { level: 1, name: 'New invoice' }, { timeout: 5000 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Organization', { exact: false }), { target: { value: 'example-press' } });
    expect(screen.getByLabelText('Name to bill')).toHaveValue('Example Press');
    expect(screen.getByLabelText('Line 1 description')).toHaveValue('Presenting');
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue('5000.00');
    expect(screen.getByText('Filled the name and a line for the Presenting package.')).toBeInTheDocument();

    const total = screen.getByTestId('invoice-total');
    expect(total).toHaveAttribute('aria-live', 'polite');
    expect(total).toHaveTextContent('Total: $5,000.00');
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '2' } });
    expect(total).toHaveTextContent('Total: $10,000.00');
    fireEvent.click(screen.getByRole('button', { name: 'Add a tax' }));
    expect(screen.getByLabelText('Tax row 1 kind')).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Tax row 1 amount'), { target: { value: '12.50' } });
    expect(total).toHaveTextContent('Total: $10,012.50');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(invoiceCalls().some((body) => body.action === 'saveDraft')).toBe(true));
    const sent = invoiceCalls().find((body) => body.action === 'saveDraft');
    expect(sent.invoiceId).toMatch(/^inv_[a-z0-9]{16,40}$/);
    expect(sent.expectedRevision).toBe(0);
    expect(sent.invoice.billTo).toMatchObject({ organizationId: 'example-press', name: 'Example Press' });
    expect(sent.invoice.lines).toEqual([{ description: 'Presenting', quantity: 2, unitAmount: 500000 }]);
    expect(sent.invoice.adjustments).toEqual([{ kind: 'tax', label: 'Tax', amount: 1250 }]);
    expect('totals' in sent.invoice).toBe(false);
    await waitFor(() => expect(currentPath).toBe(`/admin/invoices/${sent.invoiceId}`));
    // The status line states it; the toast repeats it without a live role.
    expect((await screen.findAllByText('Draft saved. It has no number until it is issued.'))[0]).toHaveAttribute('role', 'status');
  });

  it('marks a price it cannot read, moves focus there and sends nothing', async () => {
    await renderAt('/admin/invoices/new/invoice');
    await screen.findByRole('heading', { level: 1, name: 'New invoice' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Name to bill'), { target: { value: 'Example Press' } });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Booth' } });
    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '12.345' } });
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('1 row is not counted');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    const price = screen.getByLabelText('Line 1 unit price');
    await waitFor(() => expect(price).toHaveFocus());
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Use at most 2 digits after the decimal point.')).toBeInTheDocument();
    expect(invoiceCalls().some((body) => body.action === 'saveDraft')).toBe(false);
  });

  it('refuses a total below zero in words', async () => {
    await renderAt('/admin/invoices/new/invoice');
    await screen.findByRole('heading', { level: 1, name: 'New invoice' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: 'Booth' } });
    fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a discount' }));
    fireEvent.change(screen.getByLabelText('Discount row 1 label'), { target: { value: 'Too much' } });
    fireEvent.change(screen.getByLabelText('Discount row 1 amount'), { target: { value: '11' } });
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('No total: The discounts take it below zero.');
  });

  it('reopens a saved draft with its figures and sends its revision', async () => {
    answers.get = { invoice: STORED };
    answers.saveDraft = () => response({ error: { code: 'conflict', message: 'The invoice changed since you opened it. Reload it before saving.' } }, 409);
    await renderAt(`/admin/invoices/${STORED.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Line 1 unit price')).toHaveValue('2500.00');
    expect(screen.getByLabelText('Discount row 1 amount')).toHaveValue('500.00');
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('Total: $4,500.00');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Thank you.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The invoice changed since you opened it.');
    expect(invoiceCalls().find((body) => body.action === 'saveDraft').expectedRevision).toBe(3);
    expect(screen.getByRole('button', { name: 'Reload the saved invoice' })).toBeInTheDocument();
  });

  it('recovers a new draft the server already saved when a retry meets a conflict', async () => {
    let savedId = null;
    answers.saveDraft = (body) => {
      savedId = body.invoiceId;
      return response({ error: { code: 'conflict', message: 'The invoice changed since you opened it. Reload it before saving.' } }, 409);
    };
    answers.get = (body) => response({ invoice: { ...STORED, id: body.invoiceId, revision: 1, notes: 'Saved before the answer was lost.' } });
    await renderAt('/admin/invoices/new/invoice');
    await screen.findByRole('heading', { level: 1, name: 'New invoice' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Name to bill'), { target: { value: 'Example Press' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The invoice changed since you opened it.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload the saved invoice' }));
    await waitFor(() => expect(currentPath).toBe(`/admin/invoices/${savedId}`));
    expect(invoiceCalls().at(-1)).toEqual({ action: 'get', invoiceId: savedId });
    expect(await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Saved before the answer was lost.');
  });

  it('opens an invoice that is not a draft read-only', async () => {
    answers.get = { invoice: { ...STORED, status: 'issued', number: 'INV-0001' } };
    await renderAt(`/admin/invoices/${STORED.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'INV-0001' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('This invoice is issued. Its details cannot change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(screen.getByLabelText('Name to bill')).toBeDisabled();
  });
});

describe('invoice settings', () => {
  it('shows staff the settings read-only', async () => {
    await renderAt('/admin/invoices/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoice settings' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/Only an operator can change these settings/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(screen.getByLabelText('Payment instructions')).toHaveAttribute('readonly');
    expect(screen.getByText('Next number INV-0001')).toBeInTheDocument();
  });

  it('lets an operator save, with the revision it read', async () => {
    answers.settings = { ...SETTINGS, canEdit: true };
    answers.saveSettings = (body) => response({ ...SETTINGS, canEdit: true, revision: 1, settings: body.settings, nextNumber: 'SPONSOR-0001' });
    await renderAt('/admin/invoices/settings');
    await screen.findByRole('heading', { level: 1, name: 'Invoice settings' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Number prefix'), { target: { value: 'sponsor' } });
    fireEvent.change(screen.getByLabelText('Payment instructions'), { target: { value: 'Account 000000.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(invoiceCalls().some((body) => body.action === 'saveSettings')).toBe(true));
    const sent = invoiceCalls().find((body) => body.action === 'saveSettings');
    expect(sent.expectedRevision).toBe(0);
    expect(sent.settings).toMatchObject({ prefix: 'SPONSOR', paymentInstructions: 'Account 000000.' });
    expect(await screen.findByText('Next number SPONSOR-0001')).toBeInTheDocument();
    await act(async () => {});
  });
});

const ISSUED = {
  ...STORED, status: 'issued', number: 'INV-0004', revision: 4, issueDate: '2026-10-20',
  issuer: { name: 'Example Events', address: '2 High Street', email: 'events@example.org', taxId: 'TAX-1', paymentInstructions: 'Account 000000.' },
  payment: null, paymentHistory: [], voided: null, duplicatedFrom: null,
};

describe('issuing an invoice', () => {
  it('issues a saved draft after a confirmation that names the next number', async () => {
    answers.get = { invoice: STORED, canVoid: false };
    answers.settings = { ...SETTINGS, nextNumber: 'INV-0004' };
    answers.issue = (body) => response({ invoice: { ...ISSUED, id: body.invoiceId }, canVoid: false });
    await renderAt(`/admin/invoices/${STORED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByRole('heading', { name: 'Issue this invoice?' })).toBeInTheDocument();
    expect(await screen.findByText(/The next number is INV-0004\./)).toBeInTheDocument();
    expect(invoiceCalls().some((body) => body.action === 'issue')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Issue this invoice' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({ action: 'issue', invoiceId: STORED.id, expectedRevision: 3 }));
    expect(await screen.findByRole('heading', { level: 1, name: 'INV-0004' })).toBeInTheDocument();
    expect((await screen.findAllByText('Issued as INV-0004. Its details are now locked.'))[0]).toHaveAttribute('role', 'status');
    expect(screen.getByLabelText('Name to bill')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });

  it('asks for a save first when the form has changes, and sends nothing', async () => {
    answers.get = { invoice: STORED, canVoid: false };
    await renderAt(`/admin/invoices/${STORED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' }, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Changed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByText('Save the draft first. Issue uses the saved draft, not the form.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue this invoice' })).toBeNull();
    expect(invoiceCalls().some((body) => body.action === 'issue')).toBe(false);
  });

  it('does not issue when the form changed after the confirmation opened', async () => {
    answers.get = { invoice: STORED, canVoid: false };
    await renderAt(`/admin/invoices/${STORED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    const confirm = await screen.findByRole('button', { name: 'Issue this invoice' });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Changed after.' } });
    fireEvent.click(confirm);
    expect(await screen.findByText('Save the draft first. Issue uses the saved draft, not the form.')).toBeInTheDocument();
    expect(invoiceCalls().some((body) => body.action === 'issue')).toBe(false);
  });

  it('states a refused issue and marks the field it names', async () => {
    answers.get = { invoice: { ...STORED, dueDate: '2026-10-01' }, canVoid: false };
    answers.issue = () => response({ error: { code: 'bad-request', message: 'Invalid invoice: dueDate: The due date is before the issue date (2026-10-20). Change the due date.; settings.issuerName: The invoice settings have no issuer name. Ask an operator to fill in the invoice settings.' } }, 400);
    await renderAt(`/admin/invoices/${STORED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Issue invoice' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Issue this invoice' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The invoice was not issued');
    expect(alert).toHaveTextContent('Ask an operator to fill in the invoice settings.');
    expect(screen.getByLabelText('Due date', { exact: false })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('an issued invoice', () => {
  it('shows the frozen record and downloads its PDF', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    const record = screen.getByRole('region', { name: 'Invoice record' });
    expect(within(record).getByText('2026-10-20')).toBeInTheDocument();
    expect(within(record).getByText('Example Events')).toBeInTheDocument();
    expect(within(record).getByText('Account 000000.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(savedFiles).toHaveLength(1));
    expect(savedFiles[0].filename).toBe('INV-0004.pdf');
    const [url, init] = fetch.mock.calls.find(([target]) => String(target).endsWith('/invoicePdf'));
    expect(String(url)).toMatch(/\/invoicePdf$/);
    expect(JSON.parse(init.body)).toEqual({ invoiceId: ISSUED.id });
    expect(init.headers.Authorization).toBe('Bearer id-token');
  });

  it('marks the invoice paid with a date, a method and a note', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.markPaid = (body) => response({
      invoice: { ...ISSUED, status: 'paid', revision: 5, payment: { ...body.payment, recordedAt: '2026-10-20T12:00:00.000Z', recordedBy: 'admin-1' } },
      canVoid: false,
    });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    const date = await screen.findByLabelText('Date paid', { exact: false });
    await waitFor(() => expect(date).toHaveFocus());
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(date, { target: { value: '2026-10-19' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'check' } });
    fireEvent.change(screen.getByLabelText('Payment note', { exact: false }), { target: { value: 'Check 1042' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({
      action: 'markPaid', invoiceId: ISSUED.id, expectedRevision: 4, payment: { paidOn: '2026-10-19', method: 'check', note: 'Check 1042' },
    }));
    expect(await screen.findByText('Paid', { selector: '[data-invoice-status]' })).toBeInTheDocument();
    const record = screen.getByRole('region', { name: 'Invoice record' });
    expect(within(record).getByText('2026-10-19')).toBeInTheDocument();
    expect(within(record).getByText('Check')).toBeInTheDocument();
    expect(within(record).getByText('Check 1042')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });

  it('offers Void to an operator only, and a void needs a reason', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Void this invoice' })).toBeNull();
    expect(screen.getByText(/Only an operator can void an invoice or reopen a paid one\./)).toBeInTheDocument();
  });

  it('voids with the reason an operator gives, and the number stays used', async () => {
    answers.get = { invoice: ISSUED, canVoid: true };
    answers.void = (body) => response({
      invoice: { ...ISSUED, status: 'void', revision: 5, voided: { reason: body.reason, from: 'issued', at: '2026-10-20T12:00:00.000Z', by: 'admin-1' } },
      canVoid: true,
    });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Void this invoice' }));
    await waitFor(() => expect(screen.getByLabelText('Reason')).toHaveFocus());
    fireEvent.click(await screen.findByRole('button', { name: 'Void INV-0004' }));
    const reason = screen.getByLabelText('Reason');
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(invoiceCalls().some((body) => body.action === 'void')).toBe(false);
    fireEvent.change(reason, { target: { value: 'Wrong amount' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void INV-0004' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({ action: 'void', invoiceId: ISSUED.id, expectedRevision: 4, reason: 'Wrong amount' }));
    expect(await screen.findByText('Void', { selector: '[data-invoice-status]' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Invoice record' })).getByText('Wrong amount')).toBeInTheDocument();
    expect(screen.getByText(/INV-0004 stays used/)).toBeInTheDocument();
  });

  it('lets an operator reopen a paid invoice with a reason, and keeps the payment in the history', async () => {
    const payment = { paidOn: '2026-10-19', method: 'check', note: 'Check 1042', recordedAt: '2026-10-19T12:00:00.000Z', recordedBy: 'admin-1' };
    answers.get = { invoice: { ...ISSUED, status: 'paid', revision: 5, payment }, canVoid: true, canReopen: true };
    answers.reopen = (body) => response({
      invoice: {
        ...ISSUED, status: 'issued', revision: 6, payment: null,
        paymentHistory: [{ ...payment, reopenedAt: '2026-10-20T12:00:00.000Z', reopenedBy: 'admin-1', reason: body.reason }],
      },
      canVoid: true, canReopen: true,
    });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen this invoice' }));
    const reason = await screen.findByLabelText('Reason for reopening', { exact: false });
    await waitFor(() => expect(reason).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen INV-0004' }));
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(invoiceCalls().some((body) => body.action === 'reopen')).toBe(false);
    fireEvent.change(reason, { target: { value: 'Check bounced' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reopen INV-0004' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({ action: 'reopen', invoiceId: ISSUED.id, expectedRevision: 5, reason: 'Check bounced' }));
    expect(await screen.findByText('Issued', { selector: '[data-invoice-status]' })).toBeInTheDocument();
    const history = screen.getByRole('list', { name: 'Earlier payments' });
    expect(history).toHaveTextContent('2026-10-19');
    expect(history).toHaveTextContent('Check 1042');
    expect(history).toHaveTextContent('Reopened: Check bounced');
    expect(screen.getByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
  });

  it('does not offer Reopen to staff', async () => {
    answers.get = { invoice: { ...ISSUED, status: 'paid', payment: { paidOn: '2026-10-19', method: 'cash', note: '' } }, canVoid: false, canReopen: false };
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Reopen this invoice' })).toBeNull();
    expect(screen.getByText(/Only an operator can void an invoice or reopen a paid one\./)).toBeInTheDocument();
  });

  it('duplicates into a new draft and opens it', async () => {
    answers.get = (body) => response({
      invoice: body.invoiceId === ISSUED.id
        ? { ...ISSUED, status: 'void', voided: { reason: 'Wrong amount', from: 'issued', at: null, by: null } }
        : { ...STORED, id: body.invoiceId, revision: 1, duplicatedFrom: { invoiceId: ISSUED.id, number: 'INV-0004' } },
      canVoid: false,
    });
    answers.duplicate = (body) => response({
      invoice: { ...STORED, id: body.newInvoiceId, revision: 1, duplicatedFrom: { invoiceId: ISSUED.id, number: 'INV-0004' } },
      canVoid: false,
    });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate as a new draft' }));
    await waitFor(() => expect(invoiceCalls().some((body) => body.action === 'duplicate')).toBe(true));
    const sent = invoiceCalls().find((body) => body.action === 'duplicate');
    expect(sent.invoiceId).toBe(ISSUED.id);
    expect(sent.newInvoiceId).toMatch(/^inv_[a-z0-9]{16,40}$/);
    await waitFor(() => expect(currentPath).toBe(`/admin/invoices/${sent.newInvoiceId}`));
    expect(await screen.findByRole('heading', { level: 1, name: 'Draft for Example Press' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'INV-0004' })).toHaveAttribute('href', `/admin/invoices/${ISSUED.id}`);
    expect(screen.getByLabelText('Name to bill')).not.toBeDisabled();
  });
});

describe('emailing an invoice', () => {
  const RECEIPT = 'a'.repeat(64);
  function previewAnswer(extra = {}) {
    return (body) => response({
      preview: {
        to: 'billing@example.org',
        cc: body.cc ? body.cc.trim().toLowerCase() : null,
        replyTo: 'events@example.org',
        subject: 'Invoice INV-0004 from Example Events',
        text: `Hello,\n\nInvoice INV-0004 for $4,500.00 is attached as a PDF.${body.note ? `\n\n${body.note}` : ''}`,
        html: '<p>Hello,</p>',
        filename: 'INV-0004.pdf',
      },
      receipt: RECEIPT, canSend: true, cannotSendReason: null, recentSend: null, resendWindowMinutes: 15,
      ...extra,
    });
  }

  it('previews the email, then sends it to the billing email with a copy and a note', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.previewSend = previewAnswer();
    answers.send = (body) => response({
      outcome: 'sent',
      invoice: { ...ISSUED, emailSends: [{ sendId: body.sendId, status: 'sent', to: 'billing@example.org', cc: 'finance@example.org', at: '2026-10-20T12:05:00.000Z', by: 'admin-1', providerMessageId: 'console-1' }] },
      canVoid: false,
    });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    expect(within(form).getByText('billing@example.org')).toBeInTheDocument();
    await waitFor(() => expect(within(form).getByLabelText('Copy to', { exact: false })).toHaveFocus());
    fireEvent.change(within(form).getByLabelText('Copy to', { exact: false }), { target: { value: 'Finance@Example.org' } });
    fireEvent.change(within(form).getByLabelText('Note', { exact: false }), { target: { value: 'Thanks again.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toEqual({
      action: 'previewSend', invoiceId: ISSUED.id, cc: 'finance@example.org', note: 'Thanks again.',
    }));
    const preview = await within(form).findByRole('region', { name: 'Email preview' });
    expect(within(preview).getByText('Invoice INV-0004 from Example Events')).toBeInTheDocument();
    expect(within(preview).getByText('INV-0004.pdf')).toBeInTheDocument();
    expect(within(preview).getByText(/Thanks again\./)).toBeInTheDocument();

    fireEvent.click(within(form).getByRole('button', { name: 'Send to billing@example.org' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toMatchObject({
      action: 'send', invoiceId: ISSUED.id, receipt: RECEIPT, cc: 'finance@example.org', note: 'Thanks again.', confirmResend: false,
    }));
    expect(invoiceCalls().at(-1).sendId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    await waitFor(() => expect(screen.getAllByText('Emailed INV-0004 to billing@example.org, with a copy to finance@example.org.').length).toBeGreaterThan(0));
    const history = screen.getByRole('list', { name: 'Emails sent' });
    expect(within(history).getByText(/billing@example\.org/)).toBeInTheDocument();
    expect(within(history).getByText(/Sent/)).toBeInTheDocument();
  });

  it('asks for a new preview when the note changes after the preview', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.previewSend = previewAnswer();
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    await within(form).findByRole('region', { name: 'Email preview' });
    fireEvent.change(within(form).getByLabelText('Note', { exact: false }), { target: { value: 'Changed.' } });
    expect(within(form).queryByRole('region', { name: 'Email preview' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Send to billing@example.org' })).toBeNull();
  });

  it('drops a preview answer that arrives after the note changed, so Send cannot use old input', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    let release;
    const answer = previewAnswer();
    answers.previewSend = (body) => new Promise((resolve) => { release = () => resolve(answer(body)); });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    fireEvent.change(within(form).getByLabelText('Note', { exact: false }), { target: { value: 'First.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    await waitFor(() => expect(typeof release).toBe('function'));
    fireEvent.change(within(form).getByLabelText('Note', { exact: false }), { target: { value: 'Second.' } });
    await act(async () => { release(); });
    expect(within(form).queryByRole('region', { name: 'Email preview' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Send to billing@example.org' })).toBeNull();
    expect(invoiceCalls().some((body) => body.action === 'send')).toBe(false);
  });

  it('needs a confirmation to send again to an address emailed a few minutes ago', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.previewSend = previewAnswer({ recentSend: { at: '2026-10-20T12:00:00.000Z', to: 'billing@example.org' } });
    answers.send = (body) => response({ outcome: 'sent', invoice: { ...ISSUED, emailSends: [] }, canVoid: false, echo: body });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    await within(form).findByRole('region', { name: 'Email preview' });
    expect(within(form).getByText(/was emailed to billing@example\.org less than 15 minutes ago/)).toBeInTheDocument();
    const again = within(form).getByLabelText('Send it again anyway');
    fireEvent.click(within(form).getByRole('button', { name: 'Send to billing@example.org' }));
    await waitFor(() => expect(again).toHaveFocus());
    expect(invoiceCalls().some((body) => body.action === 'send')).toBe(false);
    fireEvent.click(again);
    fireEvent.click(within(form).getByRole('button', { name: 'Send to billing@example.org' }));
    await waitFor(() => expect(invoiceCalls().at(-1)).toMatchObject({ action: 'send', confirmResend: true }));
  });

  it('marks a copy address the rules refuse and sends nothing', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.previewSend = previewAnswer();
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    const cc = within(form).getByLabelText('Copy to', { exact: false });
    fireEvent.change(cc, { target: { value: 'not an address' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    await waitFor(() => expect(cc).toHaveFocus());
    expect(cc).toHaveAttribute('aria-invalid', 'true');
    expect(invoiceCalls().some((body) => body.action === 'previewSend')).toBe(false);
  });

  it('states why the site cannot send the invoice, and offers no send', async () => {
    answers.get = { invoice: ISSUED, canVoid: false };
    answers.previewSend = previewAnswer({ canSend: false, cannotSendReason: 'This site\'s email provider cannot send attachments.' });
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Email invoice' }));
    const form = await screen.findByRole('region', { name: 'Email INV-0004' });
    fireEvent.click(within(form).getByRole('button', { name: 'Preview email' }));
    expect(await within(form).findByText(/cannot send attachments/)).toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Send to billing@example.org' })).toBeNull();
  });

  it('offers no email for a void invoice', async () => {
    answers.get = { invoice: { ...ISSUED, status: 'void', voided: { reason: 'Wrong', from: 'issued', at: null, by: null } }, canVoid: true };
    await renderAt(`/admin/invoices/${ISSUED.id}`);
    await screen.findByRole('heading', { level: 1, name: 'INV-0004' }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Email invoice' })).toBeNull();
  });
});
