import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const adminSubscriptions = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
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
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

async function renderAt(path) {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
}

function pushSessions(live, drafts) {
  act(() => {
    adminSubscriptions.get('cmsSchedule')(live);
    adminSubscriptions.get('cmsSchedule_drafts')(drafts);
  });
}

function bodyOf(index) {
  return JSON.parse(fetch.mock.calls[index][1].body);
}

beforeEach(() => {
  adminSubscriptions.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('admin Sessions workspace', () => {
  it('groups by day and keeps a child directly below its parent', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions(
      [{ id: 'later', dayId: 'day-1', startTime: '10:00', title: 'Later', visible: true }],
      [
        { id: 'parent', dayId: 'day-1', startTime: '09:00', title: 'Parent', status: 'dirty' },
        { id: 'child', dayId: 'day-1', startTime: '11:00', title: 'Child', parentId: 'parent', status: 'dirty' },
      ],
    );
    const links = screen.getAllByRole('link').filter((link) =>
      ['Parent', 'Child', 'Later'].includes(link.textContent),
    );
    expect(links.map((link) => link.textContent)).toEqual(['Parent', 'Child', 'Later']);
    expect(screen.getByRole('link', { name: 'Create a session' })).toBeInTheDocument();
  });

  it('creates a draft through the generic schedule endpoint', async () => {
    await renderAt('/admin/sessions/new/session');
    await screen.findByRole('heading', { name: 'New session' });
    fetch.mockResolvedValueOnce(response({ docId: 'opening-session', status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Public title'), { target: { value: 'Opening session' } });
    expect(screen.getByLabelText('Session id')).toHaveValue('opening-session');
    fireEvent.change(screen.getByLabelText('Public description'), { target: { value: 'Welcome everyone.' } });
    fireEvent.change(screen.getByLabelText('Event day'), { target: { value: 'day-1' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/cmsCreateContent$/);
    expect(bodyOf(0)).toMatchObject({
      collection: 'cmsSchedule',
      docId: 'opening-session',
      fields: { title: 'Opening session', dayId: 'day-1', startTime: '09:00', endTime: '10:00' },
    });
  });

  it('does not save or publish until required fields are valid', async () => {
    await renderAt('/admin/sessions/new/session');
    await screen.findByRole('heading', { name: 'New session' });
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps creation separate from a session named new and encodes edit links', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions([], [
      { id: 'new', dayId: 'day-1', title: 'Named new', status: 'dirty' },
      { id: 'panel?day2#room', dayId: 'day-1', title: 'Panel', status: 'dirty' },
    ]);

    expect(screen.getByRole('link', { name: 'Create a session' }))
      .toHaveAttribute('href', '/admin/sessions/new/session');
    expect(screen.getByRole('link', { name: 'Named new' }))
      .toHaveAttribute('href', '/admin/sessions/new');
    expect(screen.getByRole('link', { name: 'Panel' }))
      .toHaveAttribute('href', '/admin/sessions/panel%3Fday2%23room');
  });

  it('resumes a part-way bulk publish with the queue id', async () => {
    await renderAt('/admin/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    pushSessions([], [
      { id: 'opening', dayId: 'day-1', title: 'Opening', status: 'dirty' },
    ]);
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: 'publish-failed', message: 'Publish failed part-way.' },
          queueId: 'queue-42',
        }),
      })
      .mockResolvedValueOnce(response({
        results: { cmsSchedule: { published: ['opening'], skipped: [] } },
      }));

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (1)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });
    fireEvent.click(resume);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({ queueId: 'queue-42' });
  });

  it('publishes a draft-only parent with its child', async () => {
    await renderAt('/admin/sessions/child');
    await waitFor(() => expect(adminSubscriptions.has('cmsSchedule_drafts')).toBe(true));
    pushSessions([], [
      {
        id: 'parent', dayId: 'day-1', startTime: '09:00', endTime: '11:00',
        title: 'Parent', description: 'Parent session.', status: 'dirty',
      },
      {
        id: 'child', dayId: 'day-1', startTime: '09:30', endTime: '10:00',
        title: 'Child', description: 'Child session.', parentId: 'parent', status: 'dirty',
      },
    ]);
    expect(await screen.findByDisplayValue('Child')).toBeInTheDocument();
    fetch
      .mockResolvedValueOnce(response({ docId: 'child', status: 'dirty' }))
      .mockResolvedValueOnce(response({
        results: { cmsSchedule: { published: ['parent', 'child'], skipped: [] } },
      }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1).docIds).toEqual(['parent', 'child']);
  });
});
