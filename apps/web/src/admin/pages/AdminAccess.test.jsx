// AdminAccess — the operator-only access page (issue #187). Mocks adminApi
// directly, same convention as AdminAttendees.test.jsx; there is no
// Firestore listener because config/bootstrap is server-only.
//
// The review of the first cut found focus falling to the body after every
// confirmed change, an unfocused invalid field, a false consequence for a
// re-grant, an empty state drawn over a failed load, and double
// announcements; each has a test here that reads document.activeElement or
// the exact words.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));

const showToastMock = vi.fn();
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ showToast: showToastMock }) }));

// The signed-in operator, and the re-probe the page asks for after it
// changes its OWN standing (connector review): the rail and the route
// refusal must follow at once, not on the next sign-in.
const refreshAdminStatusMock = vi.fn(() => Promise.resolve());
vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { uid: 'ops-1', email: 'Ops@Example.org' },
    adminTier: 'operator',
    refreshAdminStatus: refreshAdminStatusMock,
  }),
}));

import AdminAccess, { describeChange, describeResult } from './AdminAccess.jsx';
import { TIER_SCOPE } from '../AdminLayout.jsx';

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

/**
 * listAdminAccess answers `list`, or the next entry of `lists` per call;
 * setAdminAccess answers `set`, throws it when it is an Error, or hangs
 * when it is null.
 */
function serve({ list = LIST, lists = null, set = { ok: true, changed: true } } = {}) {
  let n = 0;
  callMock.mockImplementation((name) => {
    if (name === 'listAdminAccess') {
      if (lists) return Promise.resolve(lists[Math.min(n++, lists.length - 1)]);
      return Promise.resolve(list);
    }
    if (set === null) return new Promise(() => {});
    if (set instanceof Error) return Promise.reject(set);
    return Promise.resolve(set);
  });
}

async function renderPage(options) {
  serve(options);
  const result = render(<AdminAccess />);
  await screen.findByText('ops@example.org');
  return result;
}

/** The table row that holds `email`. */
function rowFor(email) {
  return screen.getByText(email).closest('tr');
}

const setCalls = () => callMock.mock.calls.filter(([name]) => name === 'setAdminAccess');
const listCalls = () => callMock.mock.calls.filter(([name]) => name === 'listAdminAccess');

beforeEach(() => {
  callMock.mockReset();
  showToastMock.mockReset();
  refreshAdminStatusMock.mockClear();
});

describe('a change to the signed-in account', () => {
  it('re-probes the tier after the operator changes their OWN standing, and not after anyone else’s', async () => {
    await renderPage();
    // Someone else: no re-probe.
    fireEvent.click(rowFor('desk@example.org').querySelector('button'));
    fireEvent.click(within(screen.getByRole('region', { name: 'Change desk@example.org to operator' })).getByRole('button', { name: 'Change to operator' }));
    await waitFor(() => expect(setCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Change desk@example.org to operator' })).toBeNull());
    expect(refreshAdminStatusMock).not.toHaveBeenCalled();

    // Their own row (the address as the server lowercases it): the tier is
    // read again so the rail and the route refusal follow at once.
    fireEvent.click(rowFor('ops@example.org').querySelectorAll('button')[1]);
    fireEvent.click(within(screen.getByRole('region', { name: 'Remove access for ops@example.org' })).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(setCalls()).toHaveLength(2));
    await waitFor(() => expect(refreshAdminStatusMock).toHaveBeenCalledTimes(1));
  });

  it('reports a write that only tidied the stored lists as no change of access', async () => {
    // The server answers changed:true when it rewrote a mis-normalized list,
    // with the tier unchanged; the sentence must not claim a new tier.
    await renderPage({ set: { ok: true, changed: true, tier: 'operator', previousTier: 'operator' } });
    fireEvent.click(rowFor('desk@example.org').querySelector('button'));
    fireEvent.click(within(screen.getByRole('region', { name: 'Change desk@example.org to operator' })).getByRole('button', { name: 'Change to operator' }));
    expect(await screen.findByText('desk@example.org already had this access.')).toBeInTheDocument();
    expect(screen.queryByText('desk@example.org is now operator.')).toBeNull();
  });
});

describe('AdminAccess', () => {
  it('lists every account in a ruled table with a tier word, and marks the signed-in operator', async () => {
    await renderPage();
    const table = screen.getByRole('table', { name: 'Admin accounts and their tier' });
    expect(table).toBeInTheDocument();
    expect(callMock).toHaveBeenCalledWith('listAdminAccess', {});

    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(rowFor('ops@example.org').textContent).toContain('Operator');
    expect(rowFor('ops@example.org').textContent).toContain('(you)');
    expect(rowFor('desk@example.org').textContent).toContain('Staff');
    expect(rowFor('desk@example.org').textContent).not.toContain('(you)');
    // The address is the machine's: set in the data face.
    expect(screen.getByText('desk@example.org').className).toContain('font-admin-data');
    // Standing facts in the title band.
    expect(screen.getByText('3 accounts, 2 operators')).toBeInTheDocument();
  });

  it('names each tier’s sections in the rail’s own words, Event included, and never “deployment settings”', async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain(`Staff run ${TIER_SCOPE.staff}.`);
    expect(TIER_SCOPE.staff).toContain('Event');
    expect(container.textContent).toContain(`including ${TIER_SCOPE.operatorOnly}.`);
    expect(container.textContent).not.toMatch(/deployment settings/);
  });

  it('grants staff access only after a confirmation that states the consequence, lowercasing the address', async () => {
    await renderPage();
    const email = screen.getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'New.Desk@Example.ORG' } });
    // The field lowercases as it goes, so the list and the field agree.
    expect(email).toHaveValue('new.desk@example.org');
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    // Nothing was sent yet: the change waits on the surface.
    expect(setCalls()).toHaveLength(0);
    const surface = screen.getByRole('region', { name: 'Grant staff access to new.desk@example.org' });
    expect(surface.textContent).toContain(`run ${TIER_SCOPE.staff}`);
    // Focus moved to the surface, so a keyboard reader lands on the question.
    expect(document.activeElement).toBe(surface);

    fireEvent.click(within(surface).getByRole('button', { name: 'Grant staff access' }));
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith('setAdminAccess', { email: 'new.desk@example.org', tier: 'staff' });
    });
    // The list reloads and the result is stated in place; the toast repeats
    // it without announcing it a second time.
    await waitFor(() => expect(listCalls()).toHaveLength(2));
    expect(await screen.findByText('Staff access granted to new.desk@example.org.')).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith('Staff access granted to new.desk@example.org.', { announce: false });
    expect(screen.queryByRole('region', { name: /Grant staff access/ })).toBeNull();
    // The form clears for the next grant, and focus goes back to the control
    // that opened the surface — not to the body.
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Grant access' })));
  });

  it('refuses an address that is not one, marks the field, and puts the keyboard on it', async () => {
    await renderPage();
    const email = screen.getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'not-an-address' } });
    const submit = screen.getByRole('button', { name: 'Grant access' });
    submit.focus();
    fireEvent.click(submit);
    expect(screen.getByText('Enter an email address.')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(document.activeElement).toBe(email));
    expect(screen.queryByRole('region')).toBeNull();
    expect(setCalls()).toHaveLength(0);
  });

  it('says so in place when the address already holds the chosen tier, and opens no confirmation', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'desk@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(screen.getByText('desk@example.org already has staff access.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(setCalls()).toHaveLength(0);
  });

  it('changes a tier through a confirmation that repeats the consequence, then hands focus back to the row’s control', async () => {
    await renderPage();
    const trigger = rowFor('desk@example.org').querySelector('button');
    expect(trigger).toHaveTextContent('Change to operator');
    trigger.focus();
    fireEvent.click(trigger);

    const surface = screen.getByRole('region', { name: 'Change desk@example.org to operator' });
    expect(surface.textContent).toContain(`gains ${TIER_SCOPE.operatorOnly}`);
    expect(document.activeElement).toBe(surface);
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to operator' }));
    await waitFor(() => {
      expect(callMock).toHaveBeenCalledWith('setAdminAccess', { email: 'desk@example.org', tier: 'operator' });
    });
    expect(await screen.findByText('desk@example.org is now operator.')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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
    const without = { ...LIST, accounts: LIST.accounts.filter((account) => account.email !== 'desk@example.org') };
    await renderPage({ lists: [LIST, without] });
    fireEvent.click(rowFor('desk@example.org').querySelectorAll('button')[1]);
    const surface = screen.getByRole('region', { name: 'Remove access for desk@example.org' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(screen.queryByText('desk@example.org')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email address')));
  });

  it('cancelling closes the surface, sends nothing, and returns focus to the control that opened it', async () => {
    await renderPage();
    const trigger = rowFor('second@example.org').querySelector('button');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Change second@example.org to staff' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(setCalls()).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('shows the server’s refusal verbatim, in place, focuses it, and keeps the surface open for another try', async () => {
    const message = 'At least one operator must keep access. Grant another account operator access first.';
    await renderPage({ set: serverError(409, 'last-operator', message) });
    fireEvent.click(rowFor('ops@example.org').querySelectorAll('button')[1]);
    const surface = screen.getByRole('region', { name: 'Remove access for ops@example.org' });
    const confirm = within(surface).getByRole('button', { name: 'Remove access' });
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    fireEvent.click(confirm);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(screen.getByRole('region', { name: 'Remove access for ops@example.org' })).toBeInTheDocument();
    // The refusal is where the keyboard is — exactly its container, not the
    // body the disabled confirm button dropped it to.
    await waitFor(() => expect(document.activeElement).toBe(alert.parentElement));
    expect(alert.parentElement.tagName).toBe('DIV');
    expect(showToastMock).toHaveBeenCalledWith(message, { tone: 'error', announce: false });
  });

  it('marks the confirm control busy while the change is in flight', async () => {
    await renderPage({ set: null });
    fireEvent.click(rowFor('desk@example.org').querySelector('button'));
    const surface = screen.getByRole('region', { name: 'Change desk@example.org to operator' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to operator' }));
    const busyButton = await within(surface).findByRole('button', { name: 'Saving…' });
    expect(busyButton).toHaveAttribute('aria-busy', 'true');
    expect(busyButton).toBeDisabled();
  });

  it('says so when a change changed nothing', async () => {
    await renderPage({ set: { ok: true, changed: false, tier: 'operator', previousTier: 'operator' } });
    // desk is staff here, so asking for operator is a change the server may
    // still report as already so (a race with another operator).
    fireEvent.click(rowFor('desk@example.org').querySelector('button'));
    const surface = screen.getByRole('region', { name: 'Change desk@example.org to operator' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to operator' }));
    expect(await screen.findByText('desk@example.org already had this access.')).toBeInTheDocument();
  });

  it('a failed first load is an error state with one retry — not an empty list, not a count', async () => {
    callMock.mockImplementation(() => Promise.reject(serverError(500, 'internal', 'down')));
    render(<AdminAccess />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The access list could not be loaded');
    expect(screen.queryByText('No admin accounts')).toBeNull();
    expect(screen.queryByText(/accounts?, \d+ operator/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    // A grant is still possible; its confirmation claims nothing about a
    // standing the page does not know, and its sentence is a sentence.
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    const surface = screen.getByRole('region', { name: 'Set staff access for new@example.org' });
    expect(surface.textContent).not.toMatch(/loses|gains/);
    expect(surface.textContent).toContain(`new@example.org will have staff access to the admin panel at once and can run ${TIER_SCOPE.staff}.`);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // One retry action, and it loads the list.
    serve();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Admin accounts and their tier' })).toBeInTheDocument();
    expect(screen.getByText('3 accounts, 2 operators')).toBeInTheDocument();
  });

  it('keeps “Try again” mounted and focused while a retry is in flight and after a second failure', async () => {
    // The first load fails at once; the retry is held open until the test
    // has looked at the page mid-flight, then fails too.
    let failures = 0;
    let failRetry;
    callMock.mockImplementation((name) => {
      if (name !== 'listAdminAccess') return Promise.resolve({});
      failures += 1;
      if (failures === 1) return Promise.reject(serverError(500, 'internal', 'down 1'));
      return new Promise((_, reject) => {
        failRetry = reject;
      });
    });
    render(<AdminAccess />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    fireEvent.click(retry);
    // In flight: the SAME control, busy, still where the keyboard is.
    const busy = await screen.findByRole('button', { name: 'Loading…' });
    expect(busy).toBe(retry);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(document.activeElement).toBe(retry);
    expect(screen.getByRole('alert').textContent).toContain('down 1');
    // Second failure: the block stays, the button is back, focus never left.
    await act(async () => {
      failRetry(serverError(500, 'internal', 'down 2'));
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('alert').textContent).toContain('down 2');
    expect(document.activeElement).toBe(retry);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a list load that lands while a confirmation is open does not pull focus back onto the surface', async () => {
    callMock.mockImplementation((name) => (name === 'listAdminAccess'
      ? Promise.reject(serverError(500, 'internal', 'down'))
      : Promise.resolve({})));
    render(<AdminAccess />);
    await screen.findByRole('button', { name: 'Try again' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    const surface = screen.getByRole('region', { name: 'Set staff access for new@example.org' });
    expect(document.activeElement).toBe(surface);
    const cancel = within(surface).getByRole('button', { name: 'Cancel' });
    cancel.focus();

    serve();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    fireEvent.click(retry);
    const table = await screen.findByRole('table', { name: 'Admin accounts and their tier' });
    // The surface is still open; the keyboard went to what was asked for.
    expect(screen.getByRole('region', { name: 'Set staff access for new@example.org' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).not.toBe(surface));
    expect(document.activeElement).toBe(table.closest('[tabindex]') ?? table);
  });

  it('a failed LATER reload keeps the list and says so', async () => {
    await renderPage();
    callMock.mockImplementation((name) => (name === 'listAdminAccess'
      ? Promise.reject(serverError(500, 'internal', 'down'))
      : Promise.resolve({ ok: true, changed: true })));
    fireEvent.click(rowFor('desk@example.org').querySelector('button'));
    const surface = screen.getByRole('region', { name: 'Change desk@example.org to operator' });
    fireEvent.click(within(surface).getByRole('button', { name: 'Change to operator' }));
    expect(await screen.findByText(/could not refresh the access list/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Admin accounts and their tier' })).toBeInTheDocument();
  });

  it('describes every change and every result in one vocabulary', () => {
    expect(describeChange({ email: 'a@example.org', tier: 'staff', previousTier: null }).confirmLabel).toBe('Grant staff access');
    expect(describeChange({ email: 'a@example.org', tier: 'operator', previousTier: null }).confirmLabel).toBe('Grant operator access');
    expect(describeChange({ email: 'a@example.org', tier: 'operator', previousTier: 'staff' }).confirmLabel).toBe('Change to operator');
    expect(describeChange({ email: 'a@example.org', tier: 'staff', previousTier: 'operator' }).confirmLabel).toBe('Change to staff');
    expect(describeChange({ email: 'a@example.org', tier: 'staff', previousTier: undefined })).toMatchObject({
      title: 'Set staff access for a@example.org',
      confirmLabel: 'Set staff access',
      destructive: false,
    });
    // No colon runs into a lowercase sentence (docs/COPY_STYLE.md).
    for (const tier of ['staff', 'operator']) {
      const words = describeChange({ email: 'a@example.org', tier, previousTier: undefined });
      expect(words.consequence).not.toMatch(/at once: [a-z]/);
      expect(words.consequence).toMatch(/at once and can (run|open)/);
    }
    expect(describeChange({ email: 'a@example.org', tier: 'none', previousTier: 'staff' })).toMatchObject({
      confirmLabel: 'Remove access',
      destructive: true,
    });
    for (const change of [
      { tier: 'staff', previousTier: null },
      { tier: 'operator', previousTier: 'staff' },
      { tier: 'staff', previousTier: 'operator' },
    ]) {
      const words = describeChange({ email: 'a@example.org', ...change });
      expect(words.consequence.includes(TIER_SCOPE.staff) || words.consequence.includes(TIER_SCOPE.operatorOnly)).toBe(true);
    }
    expect(describeResult({ email: 'a@example.org', tier: null, previousTier: 'staff' })).toBe('Access removed for a@example.org.');
    expect(describeResult({ email: 'a@example.org', tier: 'operator', previousTier: null })).toBe('Operator access granted to a@example.org.');
    expect(describeResult({ email: 'a@example.org', tier: 'staff', previousTier: 'operator' })).toBe('a@example.org is now staff.');
  });
});
