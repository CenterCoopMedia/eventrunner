// AdminMaterialsTab (issue #23, spec §4.4; bulk download and coverage,
// issue #189). session_materials has no client read at all, so the page is
// driven through mocked fetch; the sessions and speakers it reads come from
// the admin listeners, mocked at adminSource.js the way AdminSessions.test.jsx
// does it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const subscriptions = new Map();
const seeded = { cmsSchedule: [], cmsSchedule_drafts: [], speakers: [] };
const failing = new Set();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    subscriptions.set(name, { onNext, onError });
    if (failing.has(name)) onError?.(new Error('permission-denied'));
    else onNext(seeded[name] ?? []);
    return () => subscriptions.delete(name);
  },
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({
    eventConfig: {
      timezone: 'UTC',
      days: [
        { id: 'day-1', label: 'Day one' },
        { id: 'day-2', label: 'Day two' },
      ],
    },
  }),
}));

import AuthContext from '../../contexts/AuthContext.jsx';
import { ToastProvider } from '../../contexts/ToastContext.jsx';
import { NEW_TAB_NOTE } from '../../components/ExternalLink.jsx';
import AdminMaterialsTab from './AdminMaterialsTab.jsx';

const AUTH = { user: { uid: 'admin-1', getIdToken: async () => 'id-token' } };

const SESSIONS = [
  { id: 's1', title: '[Fixture] Opening keynote', dayId: 'day-1', startTime: '09:00', visible: true, speakerIds: ['ada'] },
  { id: 's2', title: '[Fixture] Breakout A', dayId: 'day-1', startTime: '10:00', visible: true, speakerIds: ['bo', 'cy'] },
  { id: 's3', title: '[Fixture] Hidden workshop', dayId: 'day-2', startTime: '09:00', visible: false, speakerIds: ['cy'] },
  { id: 's4', title: '[Fixture] Closing remarks', dayId: 'day-2', startTime: '11:00', visible: true, speakerIds: [] },
];
const DRAFTS = [
  { id: 'draft-only', title: '[Fixture] Draft only', dayId: 'day-1', startTime: '12:00', status: 'dirty', speakerIds: ['ada'] },
];
const SPEAKERS = [
  { id: 'ada', firstName: 'Ada', lastName: 'Quill', status: 'confirmed' },
  { id: 'bo', firstName: 'Bo', lastName: 'Chen', status: 'confirmed' },
  { id: 'cy', firstName: 'Cy', lastName: 'Reyes', status: 'confirmed' },
];

function file(id, sessionId, filename, reviewStatus, updatedAt = 1_700_000_000_000) {
  return {
    id, sessionId, type: 'file', filename, reviewStatus, url: null,
    storagePath: `session-materials/${sessionId}/${filename}`, submittedBySpeakerId: null, updatedAt,
  };
}
function link(id, sessionId, filename, url, reviewStatus, updatedAt = 1_700_000_000_000) {
  return { id, sessionId, type: 'link', filename, reviewStatus, url, storagePath: null, submittedBySpeakerId: null, updatedAt };
}

const MATERIALS = [
  file('m1', 's1', 'Slides.pdf', 'pending', 1_700_000_300_000),
  link('m2', 's1', 'Deck', 'https://example.org/deck', 'approved', 1_700_000_100_000),
  file('m3', 's2', 'Handout.pdf', 'rejected', 1_700_000_200_000),
  file('m4', 's3', 'Workshop.zip', 'approved', 1_700_000_400_000),
  link('m5', 's2', 'Bad', 'javascript:alert(1)', 'rejected', 1_700_000_000_000),
];

function ok(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function refusal(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

let calls;
let handlers;
let originalCreate;
let originalRevoke;

function renderTab() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthContext.Provider value={AUTH}>
        <ToastProvider>
          <AdminMaterialsTab />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  renderTab();
  await screen.findByText('Slides.pdf');
}

const callsTo = (name) => calls.filter((call) => call.name === name);
const tableRows = () => within(screen.getByRole('region', { name: 'Materials' })).getAllByRole('row').slice(1);
const rowNames = () => tableRows().map((row) => row.querySelector('td p').textContent);
const rowOf = (filename) => screen.getByText(filename, { selector: 'td p' }).closest('tr');
const countLine = () => screen.getByText(/files? selected$/);

beforeEach(() => {
  subscriptions.clear();
  failing.clear();
  seeded.cmsSchedule = SESSIONS;
  seeded.cmsSchedule_drafts = DRAFTS;
  seeded.speakers = SPEAKERS;
  calls = [];
  handlers = {
    listAllSessionMaterials: () => ok({ materials: MATERIALS, truncated: false }),
  };
  globalThis.fetch = vi.fn(async (url, init) => {
    const name = String(url).split('/').pop();
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ name, body, init });
    if (!handlers[name]) throw new Error(`unexpected call to ${name}`);
    return handlers[name](body);
  });
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
});

afterEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('AdminMaterialsTab: the list', () => {
  it('loads every material through listAllSessionMaterials, in schedule order then by name', async () => {
    await renderLoaded();
    expect(callsTo('listAllSessionMaterials')).toHaveLength(1);
    expect(callsTo('listAllSessionMaterials')[0].body).toEqual({});
    expect(callsTo('listAllSessionMaterials')[0].init.headers.Authorization).toBe('Bearer id-token');
    expect(rowNames()).toEqual(['Deck', 'Slides.pdf', 'Bad', 'Handout.pdf', 'Workshop.zip']);
    // The row says what it is and where it lives, and which session holds it.
    const slides = within(rowOf('Slides.pdf'));
    expect(slides.getByText('File')).toBeInTheDocument();
    expect(slides.getByText('session-materials/s1/Slides.pdf')).toBeInTheDocument();
    expect(slides.getByText('[Fixture] Opening keynote')).toBeInTheDocument();
    expect(slides.getByText('Pending review')).toBeInTheDocument();
  });

  it('offers every live session, a hidden one too, and no draft-only session', async () => {
    await renderLoaded();
    const select = screen.getByLabelText('Session');
    const options = within(select).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'All sessions',
      '[Fixture] Opening keynote',
      '[Fixture] Breakout A',
      '[Fixture] Hidden workshop',
      '[Fixture] Closing remarks',
    ]);
    expect(rowOf('Workshop.zip')).toHaveTextContent('[Fixture] Hidden workshop');
  });

  it('narrows the rows by session and by review state, and offers the add-link form for one session', async () => {
    await renderLoaded();
    expect(screen.queryByLabelText('Link URL')).toBeNull();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's2' } });
    expect(rowNames()).toEqual(['Bad', 'Handout.pdf']);
    expect(screen.getByLabelText('Link URL')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Session'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'approved' } });
    expect(rowNames()).toEqual(['Deck', 'Workshop.zip']);
  });

  it('flips a sort head: aria-sort and the direction in words', async () => {
    await renderLoaded();
    const sessionHead = screen.getByRole('columnheader', { name: /Session/ });
    expect(sessionHead).toHaveAttribute('aria-sort', 'ascending');
    expect(within(sessionHead).getByRole('button')).toHaveTextContent('SessionSchedule order');

    fireEvent.click(screen.getByRole('button', { name: 'Material' }));
    const materialHead = screen.getByRole('columnheader', { name: /Material/ });
    expect(materialHead).toHaveAttribute('aria-sort', 'ascending');
    expect(sessionHead).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('button', { name: 'Material A to Z' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Bad', 'Deck', 'Handout.pdf', 'Slides.pdf', 'Workshop.zip']);

    fireEvent.click(screen.getByRole('button', { name: 'Material A to Z' }));
    expect(materialHead).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('button', { name: 'Material Z to A' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Workshop.zip', 'Slides.pdf', 'Handout.pdf', 'Deck', 'Bad']);

    fireEvent.click(screen.getByRole('button', { name: 'Changed' }));
    expect(screen.getByRole('columnheader', { name: /Changed/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('button', { name: 'Changed Newest first' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Workshop.zip', 'Slides.pdf', 'Handout.pdf', 'Deck', 'Bad']);
    fireEvent.click(screen.getByRole('button', { name: 'Changed Newest first' }));
    expect(screen.getByRole('button', { name: 'Changed Oldest first' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['Bad', 'Deck', 'Handout.pdf', 'Slides.pdf', 'Workshop.zip']);
  });

  it('gives link rows no checkbox, names the new tab on Open link, and draws no link for a javascript: address', async () => {
    await renderLoaded();
    expect(within(rowOf('Deck')).queryByRole('checkbox')).toBeNull();
    expect(within(rowOf('Bad')).queryByRole('checkbox')).toBeNull();
    const open = within(rowOf('Deck')).getByRole('link', { name: `Open link (${NEW_TAB_NOTE})` });
    expect(open).toHaveAttribute('href', 'https://example.org/deck');
    expect(open).toHaveAttribute('target', '_blank');
    expect(within(rowOf('Bad')).queryByRole('link')).toBeNull();
    expect(within(rowOf('Bad')).getByText('This address is not a web link.')).toBeInTheDocument();
    expect(within(rowOf('Slides.pdf')).getByRole('checkbox', { name: 'Select Slides.pdf' })).toBeInTheDocument();
  });

  it('downloads one file through downloadSessionMaterial with its id', async () => {
    const createObjectURL = vi.fn(() => 'blob:one');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    handlers.downloadSessionMaterial = () => ({ ok: true, status: 200, blob: async () => new Blob(['%PDF']) });

    await renderLoaded();
    fireEvent.click(within(rowOf('Slides.pdf')).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(callsTo('downloadSessionMaterial')).toHaveLength(1));
    expect(callsTo('downloadSessionMaterial')[0].body).toEqual({ materialId: 'm1' });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });

  it('states a failed file download on its row', async () => {
    handlers.downloadSessionMaterial = () => refusal(404, 'not-found', 'The underlying file could not be found.');
    await renderLoaded();
    fireEvent.click(within(rowOf('Slides.pdf')).getByRole('button', { name: 'Download' }));
    expect(await within(rowOf('Slides.pdf')).findByRole('alert')).toHaveTextContent('The underlying file could not be found.');
  });
});

describe('AdminMaterialsTab: selection and the archive', () => {
  it('the count line follows the selection, and a selected row takes the soft ground as a second signal', async () => {
    await renderLoaded();
    expect(countLine()).toHaveTextContent('No files selected');
    expect(countLine()).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    expect(countLine()).toHaveTextContent('1 file selected');
    expect(rowOf('Slides.pdf')).toHaveClass('bg-admin-action-soft');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Handout.pdf' }));
    expect(countLine()).toHaveTextContent('2 files selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    expect(countLine()).toHaveTextContent('1 file selected');
    expect(rowOf('Slides.pdf')).not.toHaveClass('bg-admin-action-soft');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(countLine()).toHaveTextContent('No files selected');
  });

  it('select all takes only the file rows shown, and is indeterminate part way', async () => {
    await renderLoaded();
    const all = screen.getByRole('checkbox', { name: 'Select all files shown' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    expect(all.indeterminate).toBe(true);
    expect(all).not.toBeChecked();

    fireEvent.click(all);
    expect(countLine()).toHaveTextContent('3 files selected');
    expect(all).toBeChecked();
    expect(all.indeterminate).toBe(false);

    fireEvent.click(all);
    expect(countLine()).toHaveTextContent('No files selected');

    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files shown' }));
    expect(countLine()).toHaveTextContent('1 file selected');
    expect(screen.getByRole('checkbox', { name: 'Select Handout.pdf' })).toBeChecked();
  });

  it('a filter change clears the selection', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Workshop.zip' }));
    expect(countLine()).toHaveTextContent('2 files selected');
    fireEvent.change(screen.getByLabelText('Review'), { target: { value: 'approved' } });
    expect(countLine()).toHaveTextContent('No files selected');
    expect(screen.getByRole('checkbox', { name: 'Select Workshop.zip' })).not.toBeChecked();
  });

  it('a deleted material leaves the selection after the reload', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Workshop.zip' }));
    expect(countLine()).toHaveTextContent('2 files selected');

    handlers.deleteSessionMaterial = () => ok({ sessionId: 's1' });
    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS.filter((m) => m.id !== 'm1'), truncated: false });
    fireEvent.click(within(rowOf('Slides.pdf')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this material' }));

    await waitFor(() => expect(screen.queryByText('Slides.pdf', { selector: 'td p' })).toBeNull());
    expect(callsTo('deleteSessionMaterial')[0].body).toEqual({ materialId: 'm1' });
    expect(countLine()).toHaveTextContent('1 file selected');
  });

  it('posts the selected ids, keeps focus on the busy button, then states the result', async () => {
    let finish;
    handlers.downloadSessionMaterialsArchive = () => new Promise((resolve) => { finish = resolve; });
    URL.createObjectURL = vi.fn(() => 'blob:archive');
    URL.revokeObjectURL = vi.fn();
    const saved = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      saved.push(this.download);
    });

    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Workshop.zip' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    const button = screen.getByRole('button', { name: 'Download as archive' });
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent('Preparing archive…');
    expect(document.activeElement).toBe(button);
    // A press while busy sends nothing more.
    fireEvent.click(button);
    expect(callsTo('downloadSessionMaterialsArchive')).toHaveLength(1);
    // Table order, not the order the boxes were ticked.
    expect(callsTo('downloadSessionMaterialsArchive')[0].body).toEqual({ materialIds: ['m1', 'm4'] });
    expect(callsTo('downloadSessionMaterialsArchive')[0].init.headers.Authorization).toBe('Bearer id-token');

    await act(async () => {
      finish({ ok: true, status: 200, blob: async () => new Blob(['PK']) });
    });
    const status = await screen.findByText('Downloaded an archive of 2 files.');
    expect(status).toHaveAttribute('role', 'status');
    expect(saved).toEqual(['session-materials.zip']);
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toHaveTextContent('Download as archive');
    expect(document.activeElement).toBe(button);
  });

  it('with nothing selected, and with 51 selected, states the reason and sends nothing', async () => {
    const many = Array.from({ length: 51 }, (_, index) => file(`f${index}`, 's1', `file-${String(index).padStart(2, '0')}.pdf`, 'pending'));
    handlers.listAllSessionMaterials = () => ok({ materials: many, truncated: false });
    renderTab();
    await screen.findByText('file-00.pdf');

    fireEvent.click(screen.getByRole('button', { name: 'Download as archive' }));
    expect(screen.getByText('Select at least one file.')).toHaveAttribute('role', 'status');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files shown' }));
    expect(countLine()).toHaveTextContent('51 files selected');
    fireEvent.click(screen.getByRole('button', { name: 'Download as archive' }));
    expect(screen.getByText('An archive holds at most 50 files. 51 are selected.')).toBeInTheDocument();
    expect(callsTo('downloadSessionMaterialsArchive')).toHaveLength(0);
  });

  it('shows a 413 refusal in the server’s words', async () => {
    const message = 'materialIds: the selected files come to 250.3 MB. An archive holds at most 200 MB. Select fewer files.';
    handlers.downloadSessionMaterialsArchive = () => refusal(413, 'too-large', message);
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Slides.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download as archive' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('AdminMaterialsTab: coverage', () => {
  it('lists the sessions and the speakers with no materials, from the same list the table shows', async () => {
    await renderLoaded();
    const panel = screen.getByRole('heading', { name: 'Coverage' }).closest('section');
    // s1 has a pending file and an approved link, s3 an approved file; s2 has
    // only rejected materials; s4 has no speaker; the draft-only session is not live.
    expect(panel).toHaveTextContent(
      /2 of 3 sessions with speakers have materials\. 1 has none\. 1 speaker has no materials on any of their sessions\. Read at .+ UTC\./,
    );
    const sessionsList = within(panel).getByRole('region', { name: 'Sessions with no materials' });
    const sessionLinks = within(sessionsList).getAllByRole('link');
    expect(sessionLinks.map((node) => node.textContent)).toEqual(['[Fixture] Breakout A']);
    expect(sessionLinks[0]).toHaveAttribute('href', '/admin/sessions/s2');
    expect(sessionsList).toHaveTextContent('Day one. Speakers: Bo Chen, Cy Reyes.');

    const speakersList = within(panel).getByRole('region', { name: 'Speakers with no materials' });
    const speakerLinks = within(speakersList).getAllByRole('link');
    expect(speakerLinks.map((node) => node.textContent)).toEqual(['Bo Chen']);
    expect(speakerLinks[0]).toHaveAttribute('href', '/admin/speakers/bo');
    expect(speakersList).toHaveTextContent('Sessions: [Fixture] Breakout A.');
  });

  it('follows the list: approving the last rejected material covers every session', async () => {
    handlers.setMaterialReviewStatus = () => ok({});
    await renderLoaded();
    handlers.listAllSessionMaterials = () => ok({
      materials: MATERIALS.map((m) => (m.id === 'm3' ? { ...m, reviewStatus: 'approved' } : m)),
      truncated: false,
    });
    fireEvent.click(within(rowOf('Handout.pdf')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Every session with a speaker has at least one material.')).toBeInTheDocument();
    expect(callsTo('setMaterialReviewStatus')[0].body).toEqual({ materialId: 'm3', reviewStatus: 'approved' });
    expect(screen.queryByRole('region', { name: 'Speakers with no materials' })).toBeNull();
  });

  it('says when no session has a speaker', async () => {
    seeded.cmsSchedule = SESSIONS.map((session) => ({ ...session, speakerIds: [] }));
    await renderLoaded();
    expect(screen.getByText('No session has a speaker yet, so there is nothing to cover.')).toBeInTheDocument();
  });

  it('says above the table when the list stops at 2,000, filtered or not', async () => {
    const TRUNCATED = 'The list stops at 2,000 materials. Some materials are not shown.';
    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS, truncated: true });
    await renderLoaded();
    const notice = screen.getByText(TRUNCATED);
    expect(notice).toHaveAttribute('role', 'status');
    const region = screen.getByRole('region', { name: 'Materials' });
    expect(notice.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // An empty filter result is not a claim that nothing exists.
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's4' } });
    expect(screen.getByRole('heading', { name: 'No materials match these filters.' })).toBeInTheDocument();
    expect(screen.getByText(TRUNCATED)).toBeInTheDocument();
  });

  it('says nothing about a cut when the list is whole', async () => {
    await renderLoaded();
    expect(screen.queryByText(/The list stops at 2,000 materials/)).toBeNull();
  });

  it('withholds coverage when the list is truncated, and when a listener fails', async () => {
    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS, truncated: true });
    const { unmount } = renderTab();
    expect(await screen.findByText('The list stops at 2,000 materials, so coverage is not shown.')).toBeInTheDocument();
    expect(screen.queryByText(/sessions with speakers/)).toBeNull();
    unmount();

    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS, truncated: false });
    failing.add('speakers');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderTab();
    expect(await screen.findByText('Coverage needs the session and speaker lists, and they did not load.')).toBeInTheDocument();
  });
});

describe('AdminMaterialsTab: page states', () => {
  it('says when no session has materials, and its one action focuses the Session select', async () => {
    handlers.listAllSessionMaterials = () => ok({ materials: [], truncated: false });
    renderTab();
    expect(await screen.findByRole('heading', { name: 'No session has materials yet.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a session to add a link' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Session'));
  });

  it('says when no material matches the filters, and shows them all again', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's4' } });
    expect(screen.getByRole('heading', { name: 'No materials match these filters.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all materials' }));
    expect(rowNames()).toHaveLength(5);
    expect(screen.getByLabelText('Session')).toHaveValue('');
  });

  it('shows a failed load with a retry that loads the list', async () => {
    handlers.listAllSessionMaterials = () => refusal(500, 'internal', 'Materials could not be listed.');
    renderTab();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The materials did not load');
    expect(alert).toHaveTextContent('Materials could not be listed.');
    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS, truncated: false });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Slides.pdf')).toBeInTheDocument();
  });

  it('Try again stays in place and busy through the retry, a repeat failure mounts a fresh alert, and success moves focus to the table', async () => {
    handlers.listAllSessionMaterials = () => refusal(500, 'internal', 'Materials could not be listed.');
    renderTab();
    const first = await screen.findByRole('alert');
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();

    let answer;
    handlers.listAllSessionMaterials = () => new Promise((resolve) => { answer = resolve; });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveTextContent('Loading…');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(retry);
    expect(callsTo('listAllSessionMaterials')).toHaveLength(2);

    await act(async () => {
      answer(refusal(500, 'internal', 'Materials could not be listed.'));
    });
    const second = await screen.findByRole('alert');
    expect(second).not.toBe(first);
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveTextContent('Try again');
    expect(document.activeElement).toBe(retry);

    handlers.listAllSessionMaterials = () => ok({ materials: MATERIALS, truncated: false });
    fireEvent.click(retry);
    await screen.findByText('Slides.pdf');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Materials' })));
  });

  it('keeps the rows on screen when a refresh fails, and says so', async () => {
    await renderLoaded();
    handlers.listAllSessionMaterials = () => refusal(500, 'internal', 'Materials could not be listed.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The materials did not load');
    expect(rowNames()).toHaveLength(5);
  });

  it('Refresh states its work, ignores a second press, and keeps focus', async () => {
    await renderLoaded();
    let finish;
    handlers.listAllSessionMaterials = () => new Promise((resolve) => { finish = resolve; });
    const button = screen.getByRole('button', { name: 'Refresh' });
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveTextContent('Refreshing…');
    fireEvent.click(button);
    expect(callsTo('listAllSessionMaterials')).toHaveLength(2);

    await act(async () => {
      finish(ok({ materials: MATERIALS, truncated: false }));
    });
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).toHaveTextContent('Refresh');
    expect(document.activeElement).toBe(button);
  });

  it('clears the old error when a refresh starts, and a second failure mounts a fresh alert', async () => {
    await renderLoaded();
    handlers.listAllSessionMaterials = () => refusal(500, 'internal', 'Materials could not be listed.');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const first = await screen.findByRole('alert');

    let fail;
    handlers.listAllSessionMaterials = () => new Promise((resolve) => { fail = resolve; });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await act(async () => {
      fail(refusal(500, 'internal', 'Materials could not be listed.'));
    });
    const second = await screen.findByRole('alert');
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent('Materials could not be listed.');
  });

  it('states a refusal in the server’s words, with no retry and no coverage', async () => {
    handlers.listAllSessionMaterials = () => refusal(403, 'forbidden', 'Admin access required.');
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Coverage' })).toBeNull();
  });
});

describe('AdminMaterialsTab: row actions', () => {
  it('adds a link material for the chosen session and reloads the list', async () => {
    handlers.addSessionMaterialLink = () => ok({ id: 'm-new', material: { filename: 'External link' } });
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's4' } });
    handlers.listAllSessionMaterials = () => ok({
      materials: [...MATERIALS, link('m-new', 's4', 'External link', 'https://x.org', 'pending')],
      truncated: false,
    });
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));

    expect(await screen.findByText('External link', { selector: 'td p' })).toBeInTheDocument();
    expect(callsTo('addSessionMaterialLink')[0].body).toEqual({ sessionId: 's4', url: 'https://x.org', label: '' });
    expect(callsTo('listAllSessionMaterials')).toHaveLength(2);
  });

  it('approves a pending material via setMaterialReviewStatus', async () => {
    handlers.setMaterialReviewStatus = () => ok({});
    await renderLoaded();
    handlers.listAllSessionMaterials = () => ok({
      materials: MATERIALS.map((m) => (m.id === 'm1' ? { ...m, reviewStatus: 'approved' } : m)),
      truncated: false,
    });
    fireEvent.click(within(rowOf('Slides.pdf')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(rowOf('Slides.pdf')).getByText('Approved')).toBeInTheDocument());
    expect(callsTo('setMaterialReviewStatus')[0].body).toEqual({ materialId: 'm1', reviewStatus: 'approved' });
  });

  it('ignores a stale list response that lands after a newer one', async () => {
    let finishFirst;
    handlers.listAllSessionMaterials = () => new Promise((resolve) => { finishFirst = resolve; });
    renderTab();
    await waitFor(() => expect(callsTo('listAllSessionMaterials')).toHaveLength(1));

    // Adding a link loads the list again while the first request is out.
    handlers.addSessionMaterialLink = () => ok({ id: 'b1', material: { filename: 'External link' } });
    handlers.listAllSessionMaterials = () => ok({ materials: [file('b1', 's2', 'Newer list.pdf', 'pending')], truncated: false });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's2' } });
    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: '' } });
    expect(await screen.findByText('Newer list.pdf')).toBeInTheDocument();

    await act(async () => {
      finishFirst(ok({ materials: [file('a1', 's1', 'Stale list.pdf', 'pending')], truncated: false }));
    });
    expect(screen.queryByText('Stale list.pdf')).toBeNull();
    expect(screen.getByText('Newer list.pdf')).toBeInTheDocument();
  });
});
