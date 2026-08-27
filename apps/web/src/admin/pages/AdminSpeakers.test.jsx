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
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
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
  // Two waits, not one: the lazy admin chunk, and then the admin probe the
  // gate holds on (AdminGate renders "Checking your access…" until it
  // answers). Waiting only for the chunk lets an assertion run while the
  // gate is still checking, which is a flake under load, not a bug.
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
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
  it('lists every canonical record with its record state and its pipeline status', async () => {
    speakerDocs = [
      RAE,
      { ...RAE, id: 'sam-example', firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'draft', uid: 'u2' },
    ];
    await renderAt('/admin/speakers');

    expect(await screen.findByRole('link', { name: 'Rae Okonkwo' })).toBeInTheDocument();
    // Two axes, two words: the record's state in the admin's three-word
    // vocabulary (brief §5.2), and where the speaker is in the invitation
    // pipeline, which is a different question.
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    // The list shows unpublished records too — that is why it reads the
    // canonical store rather than the public projection.
    expect(screen.getByRole('link', { name: 'Sam Example' })).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
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
    // Moment 3: the first press states what is lost — the record and every
    // session link — and sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Delete this speaker' }));
    expect(screen.getByText(/every session that references them is unlinked/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete this speaker' }));
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
    expect(screen.queryByRole('button', { name: 'Mark this speaker removed' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete this speaker' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete this speaker' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark this speaker removed' })).toBeInTheDocument(),
    );

    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo', mode: 'soft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark this speaker removed' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark this speaker removed' }));
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

  it('omits status from an edit the admin did not make a status change in', async () => {
    // The regression: the form coerced an unsettable stored status to
    // `draft` and sent it on every save, so editing a bio silently reset
    // the invite pipeline.
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo' }));
    await renderAt('/admin/speakers/rae-okonkwo');

    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Updated bio.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).speaker).not.toHaveProperty('status');
    expect(bodyOf(0).speaker.bio).toBe('Updated bio.');
  });

  it('sends status only once the admin picks one', async () => {
    speakerDocs = [RAE];
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo' }));
    await renderAt('/admin/speakers/rae-okonkwo');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'removed' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }));
    });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).speaker.status).toBe('removed');
  });

  for (const status of ['invited', 'accepted']) {
    it(`shows a ${status} speaker's status read-only and never sends it back`, async () => {
      speakerDocs = [{ ...RAE, status }];
      fetch.mockResolvedValueOnce(okResponse({ speakerId: 'rae-okonkwo' }));
      await renderAt('/admin/speakers/rae-okonkwo');

      // No control at all — a select showing `draft` would be a lie about
      // what the record holds and an offer the server would reject.
      expect(screen.queryByLabelText('Status')).toBeNull();
      expect(screen.getByText(/Managed by the invitation flow/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Edited.' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }));
      });

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(bodyOf(0).speaker).not.toHaveProperty('status');
    });
  }

  it('always sends a status when creating, since a new record needs one', async () => {
    fetch.mockResolvedValueOnce(okResponse({ speakerId: 'a-b' }));
    await renderAt('/admin/speakers/new');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'B' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create speaker' }));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).speaker.status).toBe('draft');
  });
});

// Invite actions on the list (issue #21). The buttons offered are exactly
// the transitions the server accepts — offering one it will reject is worse
// than offering none — and every action posts { speakerId } and nothing else.
describe('invite actions', () => {
  /**
   * The list calls listSpeakerInvites once on mount, so a test that wants a
   * click's request routes by endpoint rather than counting calls.
   */
  function routeInviteFetch({ invites = [], action } = {}) {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/listSpeakerInvites')) return okResponse({ invites });
      if (typeof action === 'function') return action();
      return action ?? okResponse({});
    });
  }

  const callTo = (name) => fetch.mock.calls.find(([url]) => String(url).endsWith(`/${name}`));

  it('offers Invite for a draft speaker only', async () => {
    speakerDocs = [
      { ...RAE, id: 'draft-one', firstName: 'Draft', lastName: 'One', status: 'draft' },
      { ...RAE, id: 'published-one', firstName: 'Published', lastName: 'One', status: 'approved' },
    ];
    routeInviteFetch();
    await renderAt('/admin/speakers');

    expect(screen.getAllByRole('button', { name: 'Invite' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Resend invite' })).not.toBeInTheDocument();
  });

  it('offers Resend and Cancel for an invited speaker, and no Invite', async () => {
    speakerDocs = [{ ...RAE, id: 'invited-one', firstName: 'Invited', lastName: 'One', status: 'invited' }];
    routeInviteFetch();
    await renderAt('/admin/speakers');

    expect(screen.getByRole('button', { name: 'Resend invite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel invite' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument();
  });

  it('posts sendSpeakerInvite with the speaker id and confirms', async () => {
    speakerDocs = [{ ...RAE, id: 'draft-one', firstName: 'Draft', lastName: 'One', status: 'draft' }];
    routeInviteFetch({ action: okResponse({ speakerId: 'draft-one', status: 'invited' }) });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    });

    await waitFor(() => expect(callTo('sendSpeakerInvite')).toBeTruthy());
    expect(JSON.parse(callTo('sendSpeakerInvite')[1].body)).toEqual({ speakerId: 'draft-one' });
    expect(screen.getByText(/Invitation emailed to Draft One/)).toBeInTheDocument();
  });

  it('posts cancelSpeakerInvite and says the invitation was cancelled', async () => {
    speakerDocs = [{ ...RAE, id: 'invited-one', firstName: 'Invited', lastName: 'One', status: 'invited' }];
    routeInviteFetch({ action: okResponse({ speakerId: 'invited-one', status: 'draft' }) });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }));
    });

    await waitFor(() => expect(callTo('cancelSpeakerInvite')).toBeTruthy());
    expect(screen.getByText(/cancelled/)).toBeInTheDocument();
  });

  it('surfaces a refused transition verbatim', async () => {
    speakerDocs = [{ ...RAE, id: 'draft-one', firstName: 'Draft', lastName: 'One', status: 'draft' }];
    routeInviteFetch({
      action: errorResponse(
        409,
        'invalid-status',
        'This speaker already has an outstanding invitation. Resend it, or cancel it first.',
      ),
    });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    });

    await waitFor(() =>
      expect(screen.getByText(/already has an outstanding invitation/)).toBeInTheDocument(),
    );
  });

  it('offers Approve for an accepted speaker — the last step of the pipeline', async () => {
    // Without this the pipeline dead-ended: the editor shows a mid-pipeline
    // status read-only, so an accepted speaker had no route to `approved`
    // anywhere in the product, and `speakers_public` was unreachable.
    speakerDocs = [{ ...RAE, id: 'accepted-one', firstName: 'Accepted', lastName: 'One', status: 'accepted' }];
    routeInviteFetch({ action: okResponse({ speakerId: 'accepted-one' }) });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    });

    await waitFor(() => expect(callTo('updateSpeaker')).toBeTruthy());
    expect(JSON.parse(callTo('updateSpeaker')[1].body)).toEqual({
      speakerId: 'accepted-one',
      speaker: { status: 'approved' },
    });
    expect(screen.getByText(/now appear on the public site/)).toBeInTheDocument();
  });

  it('offers no pipeline action for a published or removed speaker', async () => {
    speakerDocs = [
      { ...RAE, id: 'published-one', firstName: 'Published', lastName: 'One', status: 'approved' },
      { ...RAE, id: 'removed-one', firstName: 'Removed', lastName: 'One', status: 'removed' },
    ];
    routeInviteFetch();
    await renderAt('/admin/speakers');

    for (const name of ['Invite', 'Resend invite', 'Cancel invite', 'Approve']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('shows an invitation that was recorded but never delivered', async () => {
    speakerDocs = [{ ...RAE, id: 'invited-one', firstName: 'Invited', lastName: 'One', status: 'invited' }];
    routeInviteFetch({
      invites: [
        { speakerId: 'invited-one', status: 'pending', sentAt: null, expiresAt: '2026-09-04T12:00:00.000Z' },
      ],
    });
    await renderAt('/admin/speakers');

    await waitFor(() => expect(screen.getByText(/Recorded, not delivered/)).toBeInTheDocument());
  });

  it('shows the expiry of a delivered invitation', async () => {
    speakerDocs = [{ ...RAE, id: 'invited-one', firstName: 'Invited', lastName: 'One', status: 'invited' }];
    routeInviteFetch({
      invites: [
        {
          speakerId: 'invited-one',
          status: 'pending',
          sentAt: '2026-08-21T12:00:00.000Z',
          expiresAt: '2026-09-04T12:00:00.000Z',
        },
      ],
    });
    await renderAt('/admin/speakers');

    await waitFor(() => expect(screen.getByText(/Expires 2026-09-04/)).toBeInTheDocument());
  });
});

describe('pending-edit review (issue #22 review finding P1-1)', () => {
  function routePendingFetch({ action } = {}) {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/listSpeakerInvites')) return okResponse({ invites: [] });
      if (typeof action === 'function') return action(String(url));
      return action ?? okResponse({});
    });
  }
  const callTo = (name) => fetch.mock.calls.find(([url]) => String(url).endsWith(`/${name}`));

  it('shows a chip and the queued field names for an approved speaker with pendingEdits', async () => {
    speakerDocs = [
      { ...RAE, id: 'rae-okonkwo', pendingEdits: { bio: 'new bio', organization: 'New Org' } },
    ];
    routePendingFetch();
    await renderAt('/admin/speakers');

    expect(screen.getByText('Changes pending review')).toBeInTheDocument();
    expect(screen.getByText(/bio, organization/)).toBeInTheDocument();
  });

  it('offers no pending-edit affordance when there is nothing queued', async () => {
    speakerDocs = [{ ...RAE, id: 'rae-okonkwo' }];
    routePendingFetch();
    await renderAt('/admin/speakers');

    expect(screen.queryByText('Changes pending review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
  });

  it('posts applySpeakerPendingEdits and confirms the changes are live', async () => {
    speakerDocs = [{ ...RAE, id: 'rae-okonkwo', pendingEdits: { bio: 'new bio' } }];
    routePendingFetch({ action: () => okResponse({ speakerId: 'rae-okonkwo', appliedFields: ['bio'] }) });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    });

    await waitFor(() => expect(callTo('applySpeakerPendingEdits')).toBeTruthy());
    expect(JSON.parse(callTo('applySpeakerPendingEdits')[1].body)).toEqual({ speakerId: 'rae-okonkwo' });
    expect(screen.getByText(/changes are now live/)).toBeInTheDocument();
  });

  it('posts discardSpeakerPendingEdits and confirms the discard', async () => {
    speakerDocs = [{ ...RAE, id: 'rae-okonkwo', pendingEdits: { bio: 'new bio' } }];
    routePendingFetch({ action: () => okResponse({ speakerId: 'rae-okonkwo' }) });
    await renderAt('/admin/speakers');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    });

    await waitFor(() => expect(callTo('discardSpeakerPendingEdits')).toBeTruthy());
    expect(JSON.parse(callTo('discardSpeakerPendingEdits')[1].body)).toEqual({ speakerId: 'rae-okonkwo' });
    expect(screen.getByText(/pending changes were discarded/)).toBeInTheDocument();
  });
});
