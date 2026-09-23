// AdminAccess — the operator-only access page (issue #187). Mocks adminApi
// directly, same convention as AdminAttendees.test.jsx; there is no
// Firestore listener because config/bootstrap is server-only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

const showToastMock = vi.fn();
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: showToastMock }) }));

import AdminAccess, { describeChange, describeResult } from './AdminAccess.jsx';

const LIST = {
  accounts: [
    { email: 'ops@example.org', tier: 'operator' },
    { email: 'second@example.org', tier: 'operator' },
    { email: 'desk@example.org', tier: 'staff' },
  ],
  callerEmail: 'ops@example.org',
};

function serverError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function renderPage(list = LIST) {
  callMock.mockImplementation(async (name) => {
    if (name === 'listAdminAccess') return list;
    return { ok: true, changed: true };
  });
  const result = render(<AdminAccess />);
  await screen.findByText('ops@example.org');
  return result;
}

/** The table row that holds `email`. */
function rowFor(email) {
  return screen.getByText(email).closest('tr');
}

beforeEach(() => {
  callMock.mockReset();
  showToastMock.mockReset();
});

describe('AdminAccess', () => {
  it('lists every account in a ruled table with a tier word, and marks the signed-in operator', async () => {
    await renderPage();
    const table = screen.getByRole('table', { name: 'Admin accounts and their tier' });
    expect(table).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith('listAdminAccess', {});

    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rowFor('ops@example.org').textContent).toContain('Operator');
    expect(rowFor('ops@example.org').textContent).toContain('(you)');
    expect(rowFor('desk@example.org').textContent).toContain('Staff');
    expect(rowFor('desk@example.org').textContent).not.toContain('(you)');
    // The address is the machine's: set in the data face.
    expect(screen.getByText('desk@example.org').className).toContain('font-admin-data');
    // Standing facts in the title band.
    expect(screen.getByText('3 accounts, 2 operators')).toBeInTheDocument();
  });

  it('grants staff access only after a confirmation that states the consequence, lowercasing the address', async () => {
    await renderPage();
    const email = screen.getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'New.Desk@Example.ORG' } });
    // The field lowercases as it goes, so the list and the field agree.
    expect(email).toHaveValue('new.desk@example.org');
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    // Nothing was sent yet: the change waits on the surface.
    expect(callMock).not.toHaveBeenCalledWith('setAdminAccess', expect.anything());
    const surface = screen.getByRole('region', { name: 'Grant staff access to new.desk@example.org' });
    expect(surface.textContent).toContain('can sign in to the admin panel at once');
    // Focus moved to the surface, so a keyboard reader lands on the question.
    expect(document.activeElement).toBe(surface);

    fireEvent.click(screen.getByRole('button', { name: 'Grant staff access' }));
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith('setAdminAccess', { email: 'new.desk@example.org', tier: 'staff' });
    });
    // The list reloads and the result is stated in place, not only toasted.
    await waitFor(() => expect(callMock.mock.calls.filter(([name]) => name === 'listAdminAccess')).toHaveLength(2));
    expect(await screen.findByText('Staff access granted to new.desk@example.org.')).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith('Staff access granted to new.desk@example.org.');
    expect(screen.queryByRole('region', { name: /Grant staff access/ })).toBeNull();
    // The form clears for the next grant.
    expect(screen.getByLabelText('Email address')).toHaveValue('');
  });

  it('refuses to open a confirmation for an address that is not one', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(screen.getByText('Enter an email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('changes a tier through a confirmation that repeats the consequence', async () => {
    await renderPage();
    const trigger = rowFor('desk@example.org').querySelector('button');
    expect(trigger).toHaveTextContent('Change to operator');
    fireEvent.click(trigger);

    const surface = screen.getByRole('region', { name: 'Change desk@example.org to operator' });
    expect(surface.textContent).toContain('gains Features, Branding, Access and System errors');
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to operator' }));
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith('setAdminAccess', { email: 'desk@example.org', tier: 'operator' });
    });
    expect(await screen.findByText('desk@example.org is now operator.')).toBeInTheDocument();
  });

  it('removes access through a still, alarm-toned confirmation', async () => {
    await renderPage();
    fireEvent.click(rowFor('desk@example.org').querySelectorAll('button')[1]);
    const surface = screen.getByRole('region', { name: 'Remove access for desk@example.org' });
    expect(surface.className).toContain('bg-admin-ground-alarm');
    expect(surface.textContent).toContain('loses access to the admin panel at once');
    // The confirm button repeats the consequence, never "Yes".
    fireEvent.click(within(surface).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith('setAdminAccess', { email: 'desk@example.org', tier: 'none' });
    });
    expect(await screen.findByText('Access removed for desk@example.org.')).toBeInTheDocument();
  });

  it('after a removal, focus lands on the grant field rather than on the body', async () => {
    await renderPage();
    fireEvent.click(rowFor('desk@example.org').querySelectorAll('button')[1]);
    const surface = screen.getByRole('region', { name: 'Remove access for desk@example.org' });
    // The reload answers without the removed row, so the trigger is gone.
    callMock.mockImplementation(async (name) => (name === 'listAdminAccess'
      ? { ...LIST, accounts: LIST.accounts.filter((account) => account.email !== 'desk@example.org') }
      : { ok: true, changed: true }));
    fireEvent.click(within(surface).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(screen.queryByText('desk@example.org')).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'));
  });

  it('cancelling closes the surface, sends nothing, and returns focus to the control that opened it', async () => {
    await renderPage();
    const trigger = rowFor('second@example.org').querySelector('button');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Change second@example.org to staff' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region')).toBeNull();
    expect(callMock).not.toHaveBeenCalledWith('setAdminAccess', expect.anything());
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the server’s refusal verbatim, in place, and keeps the surface open for another try', async () => {
    await renderPage();
    callMock.mockImplementation(async (name) => {
      if (name === 'listAdminAccess') return LIST;
      throw serverError(409, 'last-operator', 'At least one operator must keep access. Grant another account operator access first.');
    });
    fireEvent.click(rowFor('ops@example.org').querySelectorAll('button')[1]);
    const surface = screen.getByRole('region', { name: 'Remove access for ops@example.org' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Remove access' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('At least one operator must keep access. Grant another account operator access first.');
    expect(screen.getByRole('region', { name: 'Remove access for ops@example.org' })).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith(
      'At least one operator must keep access. Grant another account operator access first.',
      { tone: 'error' },
    );
  });

  it('says so when a grant changed nothing', async () => {
    await renderPage();
    callMock.mockImplementation(async (name) => {
      if (name === 'listAdminAccess') return LIST;
      return { ok: true, changed: false, tier: 'staff', previousTier: 'staff' };
    });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'desk@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    // An address already listed opens the change as a change, not a grant.
    const surface = screen.getByRole('region', { name: 'Change desk@example.org to staff' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to staff' }));
    expect(await screen.findByText('desk@example.org already had this access.')).toBeInTheDocument();
  });

  it('fails soft on a load error and states an empty list', async () => {
    callMock.mockImplementation(async () => { throw serverError(500, 'internal', 'down'); });
    render(<AdminAccess />);
    expect(await screen.findByText(/could not load the access list/)).toBeInTheDocument();

    cleanup();
    callMock.mockReset();
    callMock.mockImplementation(async () => ({ accounts: [], callerEmail: 'ops@example.org' }));
    render(<AdminAccess />);
    expect(await screen.findByText('No admin accounts')).toBeInTheDocument();
  });

  it('describes every change and every result in one vocabulary', () => {
    expect(describeChange({ email: 'a@example.org', tier: 'staff', previousTier: null }).confirmLabel).toBe('Grant staff access');
    expect(describeChange({ email: 'a@example.org', tier: 'operator', previousTier: null }).confirmLabel).toBe('Grant operator access');
    expect(describeChange({ email: 'a@example.org', tier: 'operator', previousTier: 'staff' }).confirmLabel).toBe('Change to operator');
    expect(describeChange({ email: 'a@example.org', tier: 'staff', previousTier: 'operator' }).confirmLabel).toBe('Change to staff');
    expect(describeChange({ email: 'a@example.org', tier: 'none', previousTier: 'staff' })).toMatchObject({
      confirmLabel: 'Remove access',
      destructive: true,
    });
    expect(describeResult({ email: 'a@example.org', tier: null, previousTier: 'staff' })).toBe('Access removed for a@example.org.');
    expect(describeResult({ email: 'a@example.org', tier: 'operator', previousTier: null })).toBe('Operator access granted to a@example.org.');
    expect(describeResult({ email: 'a@example.org', tier: 'staff', previousTier: 'operator' })).toBe('a@example.org is now staff.');
  });
});
