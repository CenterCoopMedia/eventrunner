// Admin speakers list + editor (issue #20). The HTTP seam is mocked, so
// these assert the exact request bodies the server contract expects:
//
//   • Create   → createSpeaker { speaker: {...} }, never a `uid` or
//                `inviteToken` (spec §4.3 seam #3 — both halves of the
//                users.speakerId ↔ speakers.uid pair move server-side).
//   • Update   → updateSpeaker { speakerId, speaker: {...} }.
//   • Delete   → deleteSpeaker { speakerId, soft: false }; a 409
//                too-many-references offers the soft delete, which is the
//                fallback §4.3 names.
//   • Server 400 → surfaced VERBATIM, including each `field: reason`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({ subscribeContentCollection: () => () => {} }));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

let speakerDocs = [];
let listenerError = null;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    if (name === 'speakers') {
      onNext(speakerDocs);
      if (listenerError) onError?.(listenerError);
    } else {
      onNext([]);
    }
    return () => {};
  },
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
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';

const RAE = {
  id: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  slug: 'rae-okonkwo',
  email: 'rae@example.org',
  bio: 'Community reporter.',
  headshotPath: 'speakers/rae.jpg',
  organization: '[Demo] Cooperative',
  jobTitle: 'Editor',
  socialHandles: {},
  status: 'approved',
  uid: null,
  inviteToken: null,
  approvedAt: 'ignored',
  updatedAt: 'ignored',
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

async function renderAt(path) {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

const bodyOf = (i) => JSON.parse(fetch.mock.calls[i][1].body);
const urlOf = (i) => String(fetch.mock.calls[i][0]);

beforeEach(() => {
  speakerDocs = [];
  listenerError = null;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('speakers list', () => {
  it('lists every canonical record with its pipeline status', async () => {
    speakerDocs = [
      RAE,
      { ...RAE, id: 'sam-example', firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'draft', uid: 'u2' },
    ];
    await renderAt('/admin/speakers');

    expect(screen.getByRole('link', { name: 'Rae Okonkwo' })).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    // The list shows unpublished records too — that is why it reads the
    // canonical store rather than the public projection.
    expect(screen.getByRole('link', { name: 'Sam Example' })).toBeInTheDocument();
    expect(screen.getByText('Not invited')).toBeInTheDocument();
    expect(screen.getByText('Account linked')).toBeInTheDocument();
  });

  it('offers an empty state with a way in when there are no speakers', async () => {
    await renderAt('/admin/speakers');
    expect(screen.getByText('No speakers yet')).toBeInTheDocument();
  });

  it('fails soft when the listener errors', async () => {
    speakerDocs = [RAE];
    listenerError = new Error('permission denied');
    await renderAt('/admin/speakers');
    expect(screen.getByRole('link', { name: 'Rae Okonkwo' })).toBeInTheDocument();
    expect(screen.getByText(/lost the connection to the speaker list/)).toBeInTheDocument();
  });
});

describe('speaker editor', () => {
  it('creates a speaker without ever sending the server-owned link fields', async () => {
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo' }));
    await renderAt('/admin/speakers/new');

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Rae' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Okonkwo' } });
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Editor' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create speaker' }));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/createSpeaker$/);
    const body = bodyOf(0);
    expect(body.speaker.firstName).toBe('Rae');
    expect(body.speaker.jobTitle).toBe('Editor');
    expect(body.speaker).not.toHaveProperty('uid');
    expect(body.speaker).not.toHaveProperty('inviteToken');
    expect(body.speaker).not.toHaveProperty('approvedAt');
  });

  it('sends an empty optional field as null rather than an empty string', async () => {
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'a-b' }));
    await renderAt('/admin/speakers/new');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'B' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create speaker' }));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).speaker.email).toBeNull();
    expect(bodyOf(0).speaker.headshotPath).toBeNull();
  });

  it('loads an existing record and updates it by id', async () => {
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo' }));
    await renderAt('/admin/speakers/rae-okonkwo');

    expect(screen.getByLabelText('First name')).toHaveValue('Rae');
    expect(screen.getByLabelText('Bio')).toHaveValue('Community reporter.');

    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Updated bio.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/updateSpeaker$/);
    expect(bodyOf(0).speakerId).toBe('rae-okonkwo');
    expect(bodyOf(0).speaker.bio).toBe('Updated bio.');
  });

  it('shows a server rejection verbatim, field by field', async () => {
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'firstName: must be a non-empty string; slug: must be lowercase letters, digits, and single hyphens'),
    );
    await renderAt('/admin/speakers/rae-okonkwo');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }));
    });

    // Each segment appears twice on purpose: once in the summary, once
    // against the input it names (aria-describedby).
    await waitFor(() =>
      expect(screen.getAllByText('firstName: must be a non-empty string').length).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getAllByText('slug: must be lowercase letters, digits, and single hyphens').length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('URL slug')).toHaveAttribute('aria-invalid', 'true');
  });

  it('deletes through the atomic unlink endpoint', async () => {
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(
      okResponse({ speakerId: 'rae-okonkwo', mode: 'hard', unlinkedSessions: ['s1'], unlinkedDrafts: [] }),
    );
    await renderAt('/admin/speakers/rae-okonkwo');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete speaker' }));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/deleteSpeaker$/);
    expect(bodyOf(0)).toEqual({ speakerId: 'rae-okonkwo', soft: false });
  });

  it('offers the soft delete only after the server refuses the full unlink', async () => {
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(
      errorResponse(409, 'too-many-references', 'This speaker is referenced by 600 session documents…'),
    );
    await renderAt('/admin/speakers/rae-okonkwo');

    // Not offered up front: two delete buttons nobody can tell apart is
    // worse than one plus a named fallback.
    expect(screen.queryByRole('button', { name: 'Mark removed instead' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete speaker' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark removed instead' })).toBeInTheDocument(),
    );

    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo', mode: 'soft' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark removed instead' }));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({ speakerId: 'rae-okonkwo', soft: true });
  });

  it('has no control for the account link, which is server-owned', async () => {
    speakerDocs = [{ ...RAE, uid: 'u1' }];
    await renderAt('/admin/speakers/rae-okonkwo');
    expect(screen.queryByLabelText(/uid/i)).toBeNull();
    expect(screen.getByText(/managed by the invitation flow/)).toBeInTheDocument();
  });

  it('offers only the admin-settable statuses', async () => {
    speakerDocs = [RAE];
    await renderAt('/admin/speakers/rae-okonkwo');
    const options = [...screen.getByLabelText('Status').options].map((o) => o.value);
    // `invited` and `accepted` belong to the invite pipeline: they are
    // meaningful only alongside an inviteToken the server issues.
    expect(options).toEqual(['draft', 'approved', 'removed']);
  });
});
