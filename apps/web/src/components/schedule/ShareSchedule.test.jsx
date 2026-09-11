// ShareSchedule — the owner's consent panel (issue #172). The source module
// is mocked; the panel's own behaviour is what is under test: the choice,
// the double press before widening, and the honest copy link.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthContext from '../../contexts/AuthContext.jsx';
import ShareSchedule from './ShareSchedule.jsx';

const subscribeMock = vi.fn(() => () => {});
const setVisibilityMock = vi.fn(async () => ({ scheduleVisibility: 'private', sessionIds: [] }));

vi.mock('../../lib/scheduleShareSource.js', () => ({
  SCHEDULE_VISIBILITIES: ['private', 'attendees_only', 'public'],
  subscribeOwnScheduleShare: (...args) => subscribeMock(...args),
  setScheduleVisibility: (...args) => setVisibilityMock(...args),
}));

vi.mock('../../lib/clipboard.js', () => ({
  copyTextToClipboard: vi.fn(async (text) => {
    copyMock.lastText = text;
    return true;
  }),
}));
const copyMock = { lastText: '' };

function renderPanel({ user = { uid: 'u1' }, share = null } = {}) {
  subscribeMock.mockImplementation((_uid, onNext) => {
    onNext(share);
    return () => {};
  });
  return render(
    <AuthContext.Provider value={{ user }}>
      <ShareSchedule uid={user.uid} />
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  subscribeMock.mockReset();
  subscribeMock.mockImplementation(() => () => {});
  setVisibilityMock.mockReset();
  setVisibilityMock.mockImplementation(async ({ visibility }) => ({
    scheduleVisibility: visibility,
    sessionIds: [],
  }));
});

describe('ShareSchedule', () => {
  it('opens on private for an owner who has never saved anything', () => {
    renderPanel({ share: null });
    expect(screen.getByRole('radio', { name: /Nobody/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Anyone/ })).not.toBeChecked();
  });

  it('applies a narrowing choice at once', async () => {
    renderPanel({ share: { scheduleVisibility: 'public', sessionIds: ['s1'] } });
    fireEvent.click(screen.getByRole('radio', { name: /Nobody/ }));
    await waitFor(() => expect(setVisibilityMock).toHaveBeenCalled());
    expect(setVisibilityMock.mock.calls[0][0].visibility).toBe('private');
  });

  it('widening asks twice before it applies', async () => {
    renderPanel({ share: { scheduleVisibility: 'private', sessionIds: ['s1'] } });

    fireEvent.click(screen.getByRole('radio', { name: /Anyone/ }));
    expect(setVisibilityMock).not.toHaveBeenCalled();
    // The confirm names what the wider world would see.
    expect(
      screen.getByText('Anyone with your link will be able to see your saved sessions.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep it as it is' }));
    expect(setVisibilityMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Anyone/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Share with anyone' }));
    await waitFor(() => expect(setVisibilityMock).toHaveBeenCalled());
    expect(setVisibilityMock.mock.calls[0][0].visibility).toBe('public');
  });

  it('one level of widening confirms too', async () => {
    renderPanel({ share: { scheduleVisibility: 'private', sessionIds: [] } });
    fireEvent.click(screen.getByRole('radio', { name: /Attendees/ }));
    expect(
      screen.getByText('Signed-in attendees will be able to see your saved sessions.'),
    ).toBeInTheDocument();
  });

  it('offers the copy link at every level, and it names the public page, not the owner doc', async () => {
    renderPanel({ share: { scheduleVisibility: 'private', sessionIds: ['s1'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy your schedule link' }));
    await waitFor(() => expect(copyMock.lastText).toBe('http://localhost:3000/schedule/user/u1'));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
  });

  it('a refusal from the server is stated, not swallowed', async () => {
    setVisibilityMock.mockRejectedValueOnce(new Error('The schedule visibility could not be saved.'));
    renderPanel({ share: { scheduleVisibility: 'public', sessionIds: ['s1'] } });
    fireEvent.click(screen.getByRole('radio', { name: /Nobody/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The schedule visibility could not be saved.',
    );
  });
});
