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
  globalThis.fetch = vi.fn(async (url, init) => {
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
