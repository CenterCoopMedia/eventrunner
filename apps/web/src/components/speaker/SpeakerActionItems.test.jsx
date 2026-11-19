import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const listMaterials = vi.fn();
vi.mock('../../lib/speakerMaterialsApi.js', () => ({
  listSpeakerSessionMaterials: (...args) => listMaterials(...args),
}));

const { default: SpeakerActionItems } = await import('./SpeakerActionItems.jsx');

const speaker = {
  speakerId: 'rae', firstName: 'Rae', lastName: 'Okonkwo', bio: '', headshotPath: null,
};
const user = { uid: 'account-one' };
const scheduleData = [
  { id: 'one', title: 'Opening', visible: true, speakerIds: ['rae'] },
  { id: 'two', title: 'Closing', visible: true, speakerIds: ['rae'] },
  { id: 'foreign', title: 'Another session', visible: true, speakerIds: ['other'] },
  { id: 'hidden', title: 'Unpublished', visible: false, speakerIds: ['rae'] },
];

function view(overrides = {}) {
  return (
    <MemoryRouter>
      <SpeakerActionItems
        speaker={speaker}
        scheduleData={scheduleData}
        eventConfig={{}}
        user={user}
        refreshKey={0}
        {...overrides}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  listMaterials.mockReset().mockImplementation(({ sessionId }) =>
    Promise.resolve(sessionId === 'two' ? [{ reviewStatus: 'pending' }] : [{ reviewStatus: 'rejected' }]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('speaker action items', () => {
  it('explains a pending check outside busy content without repeating its reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    listMaterials.mockReturnValue(pending);
    render(view());

    const status = screen.getByRole('status', { name: 'Checking your next steps…' });
    const region = screen.getByRole('region', { name: 'Speaker checklist' });
    expect(status.closest('[aria-busy="true"]')).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(999));
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    act(() => vi.advanceTimersByTime(1));
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'active');
    act(() => vi.advanceTimersByTime(9000));
    expect(status).toHaveTextContent('This is taking longer than usual.');
    act(() => vi.advanceTimersByTime(50000));
    expect(status).toHaveTextContent('We haven’t received a result after a minute.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(listMaterials).toHaveBeenCalledTimes(2);

    await act(async () => finish([{ reviewStatus: 'approved' }]));
    expect(screen.queryByRole('status', { name: 'Checking your next steps…' })).toBeNull();
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('progressbar', { name: '2 of 4 items complete' })).toBeInTheDocument();
  });

  it('shows a fast result immediately and starts a new clock for a different account', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    listMaterials.mockReturnValue(pending);
    const { rerender } = render(view());
    act(() => vi.advanceTimersByTime(300));
    await act(async () => finish([{ reviewStatus: 'approved' }]));
    expect(screen.queryByRole('status', { name: 'Checking your next steps…' })).toBeNull();
    expect(screen.getByRole('progressbar', { name: '2 of 4 items complete' })).toBeInTheDocument();

    listMaterials.mockReturnValue(new Promise(() => {}));
    rerender(view({ user: { uid: 'account-two' } }));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('status')).toHaveTextContent('This is taking longer than usual.');
    rerender(view({ user: { uid: 'account-three' } }));
    const status = screen.getByRole('status', { name: 'Checking your next steps…' });
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'initial');
    expect(status).not.toHaveTextContent('This is taking longer than usual.');
    expect(screen.queryByRole('progressbar')).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(status.closest('.loading-state')).toHaveAttribute('data-loading-stage', 'active');
  });

  it('checks only assigned visible sessions and links each actual gap to its fixer', async () => {
    render(view());

    expect(await screen.findByRole('progressbar', { name: '1 of 4 items complete' })).toHaveAttribute('max', '4');
    expect(listMaterials.mock.calls.map(([args]) => args.sessionId).sort()).toEqual(['one', 'two']);
    expect(screen.getByText('Add your biography')).toBeInTheDocument();
    expect(screen.getByText('Add your headshot')).toBeInTheDocument();
    expect(screen.getByText('Send materials for Opening')).toBeInTheDocument();
    expect(screen.queryByText('Send materials for Closing')).toBeNull();
    expect(screen.queryByText('Another session')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/speaker/profile',
      '/speaker/profile',
      '/speaker/dashboard?session=one&tab=materials#speaker-sessions-heading',
    ]);
  });

  it('shows no outstanding items when every requirement is met', async () => {
    listMaterials.mockResolvedValue([{ reviewStatus: 'approved' }]);
    render(view({ speaker: { ...speaker, bio: 'A biography.', headshotPath: 'speaker-photos/rae/photo.png' } }));

    expect(await screen.findByRole('progressbar', { name: '4 of 4 items complete' })).toHaveAttribute('value', '4');
    expect(screen.getByText('Your speaker checklist is complete.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('withholds a completion claim when materials fail to load, then retries', async () => {
    listMaterials.mockRejectedValueOnce(new Error('offline'));
    render(view());
    expect(await screen.findByText('Your materials could not be checked.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(listMaterials).toHaveBeenCalledTimes(4));
    expect(await screen.findByRole('progressbar', { name: '1 of 4 items complete' })).toBeInTheDocument();
  });

  it('refreshes the same session after a material submission', async () => {
    listMaterials.mockResolvedValueOnce([{ reviewStatus: 'rejected' }])
      .mockResolvedValueOnce([{ reviewStatus: 'pending' }]);
    const props = { scheduleData: scheduleData.slice(0, 1) };
    const { rerender } = render(view(props));
    expect(await screen.findByRole('progressbar', { name: '0 of 3 items complete' })).toBeInTheDocument();

    rerender(view({ ...props, refreshKey: 1 }));
    expect(await screen.findByRole('progressbar', { name: '1 of 3 items complete' })).toBeInTheDocument();
  });

  it('keeps the checklist visible when an unrelated schedule entry changes', async () => {
    const { rerender } = render(view());
    expect(await screen.findByRole('progressbar', { name: '1 of 4 items complete' })).toBeInTheDocument();
    expect(listMaterials).toHaveBeenCalledTimes(2);

    rerender(view({
      scheduleData: scheduleData.map((session) => (
        session.id === 'foreign' ? { ...session, title: 'Another updated session' } : session
      )),
    }));

    expect(screen.getByRole('progressbar', { name: '1 of 4 items complete' })).toBeInTheDocument();
    expect(listMaterials).toHaveBeenCalledTimes(2);
  });

  it('does not show the previous account result after a switch', async () => {
    const pending = {};
    pending.promise = new Promise((resolve) => { pending.resolve = resolve; });
    listMaterials.mockImplementationOnce(() => pending.promise);
    const { rerender } = render(view({ scheduleData: scheduleData.slice(0, 1) }));
    rerender(view({
      speaker: { ...speaker, speakerId: 'sam', firstName: 'Sam' },
      user: { uid: 'account-two' },
      scheduleData: [{ id: 'sam-session', title: 'Sam session', visible: true, speakerIds: ['sam'] }],
    }));
    pending.resolve([{ reviewStatus: 'approved' }]);
    expect(await screen.findByRole('progressbar', { name: '0 of 3 items complete' })).toBeInTheDocument();
    expect(screen.getByText('Send materials for Sam session')).toBeInTheDocument();
    expect(screen.queryByText('Send materials for Opening')).toBeNull();
  });
});
