// Call settings: an operator chooses this site's form or an external form
// (for example, Airtable). A blank external address never saves, because the
// server would read it as "no external form" and reopen native intake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let pitchCall;
const call = vi.fn();
vi.mock('../../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext) => { onNext(pitchCall); return () => {}; },
}));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => { onNext([]); return () => {}; },
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: true }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { days: [] } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

import AdminSessionPitches from './AdminSessionPitches.jsx';

const CLOSES_AT = '2027-01-31T23:59:59-05:00';
const FORM = 'https://airtable.com/appExample/shrExample';

function open() {
  render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
  fireEvent.click(screen.getByText('Manage the call for sessions'));
}

beforeEach(() => {
  call.mockReset();
  call.mockResolvedValue({});
});
afterEach(cleanup);

describe('AdminSessionPitches call settings', () => {
  it('saves this site’s form as no external form', async () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('native');
    expect(screen.queryByLabelText('External form address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save call settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null }));
  });

  it('saves an external form address', async () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: ` ${FORM} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save call settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: CLOSES_AT, externalFormUrl: FORM }));
  });

  it('refuses a blank external address in place and keeps focus on it', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save call settings' }).closest('form'));
    expect(call).not.toHaveBeenCalled();
    const field = screen.getByLabelText('External form address');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(screen.getByText('Enter the form address, or choose this site’s pitch form.')).toBeInTheDocument();
  });

  it('refuses an http address in place before calling the server', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: 'http://airtable.com/shrExample' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save call settings' }).closest('form'));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByLabelText('External form address')).toHaveFocus();
    expect(screen.getByText('Use an address that starts with https://.')).toBeInTheDocument();
  });

  it('shows this site’s form when the stored address is one the site would not use', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: 'http://airtable.com/shr' };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('native');
  });

  it('opens on the saved external form', () => {
    pitchCall = { enabled: false, closesAt: CLOSES_AT, externalFormUrl: FORM };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('external');
    expect(screen.getByLabelText('External form address')).toHaveValue(FORM);
  });
});
