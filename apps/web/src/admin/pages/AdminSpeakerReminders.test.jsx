// The speaker reminders page (functions/src/speakers/reminders.cjs). Mocks
// adminApi directly, as AdminEmailLog.test.jsx does: the endpoint is the
// only data source, and every reminder is rendered on the server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const callMock = vi.fn();
const saveTextFile = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));
vi.mock('../downloadFile.js', () => ({ saveTextFile: (...args) => saveTextFile(...args) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'UTC' } }),
}));

import AdminSpeakerReminders from './AdminSpeakerReminders.jsx';

function row(id, name, missing, extra = {}) {
  return {
    id,
    name,
    status: 'accepted',
    hasEmail: true,
    readiness: {
      bio: missing.includes('bio'),
      headshot: missing.includes('headshot'),
      descriptionSessions: missing.includes('description') ? [{ id: 's2', title: 'Workshop' }] : [],
      materialsSessions: missing.includes('materials') ? [{ id: 's1', title: 'Panel one' }] : [],
      missing,
    },
    lastRemindedAt: null,
    lastRemindedItems: [],
    canRemindAfter: null,
    ...extra,
  };
}

const ROWS = [
  row('ada', 'Ada Lee', ['headshot', 'materials']),
  row('ben', 'Ben Ode', ['description'], {
    status: 'approved',
    lastRemindedAt: '2026-10-18T09:30:00.000Z',
    lastRemindedItems: ['description'],
    canRemindAfter: '2026-10-19T09:30:00.000Z',
  }),
  row('cal', 'Cal Done', []),
];

const PREVIEW = {
  topics: ['bio', 'headshot', 'description', 'materials'],
  recipients: [{
    speakerId: 'ada',
    name: 'Ada Lee',
    to: 'ada@example.test',
    items: ['headshot', 'materials'],
    subject: 'Items we still need for Example Event',
    html: '<p>Hi Ada Lee, &lt;b&gt;</p>',
    text: 'Hi Ada Lee,\n- Add a headshot to your speaker profile.',
  }],
  skipped: [{ speakerId: 'ben', name: 'Ben Ode', reason: 'recent', message: 'This speaker was reminded less than 24 hours ago.' }],
  usedFallback: false,
  wordingVersion: 'wording-v1',
};

const TEMPLATE = {
  id: 'speaker.reminder',
  shipped: { subject: 'Items we still need for {{event_name}}', html: '<p>{{dashboard_url}}</p>', text: '{{dashboard_url}}' },
  saved: null,
  reminderTokens: ['speaker_name', 'dashboard_url', 'materials_sessions'],
  globalTokens: ['event_name'],
  requiredTokens: ['dashboard_url'],
};

function serve(overrides = {}) {
  callMock.mockImplementation((name, body) => {
    expect(name).toBe('speakerReminders');
    const answer = overrides[body.action];
    if (answer instanceof Error) return Promise.reject(answer);
    if (typeof answer === 'function') return Promise.resolve().then(() => answer(body));
    if (answer !== undefined) return Promise.resolve(answer);
    if (body.action === 'list') return Promise.resolve({ speakers: ROWS });
    if (body.action === 'template') return Promise.resolve(TEMPLATE);
    if (body.action === 'preview') return Promise.resolve(PREVIEW);
    if (body.action === 'send') {
      return Promise.resolve({ batchId: body.batchId, sent: [{ speakerId: 'ada', name: 'Ada Lee' }], alreadySent: [], skipped: [], failed: [] });
    }
    return Promise.reject(new Error(`unexpected ${body.action}`));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.search}</p>;
}

function renderPage(path = '/admin/speakers/reminders/send') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/speakers/reminders/send" element={<><AdminSpeakerReminders /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function callsFor(action) {
  return callMock.mock.calls.filter(([, body]) => body.action === action).map(([, body]) => body);
}

beforeEach(() => {
  callMock.mockReset();
  saveTextFile.mockReset();
  serve();
});

describe('speaker reminders list', () => {
  it('shows each accepted speaker with the missing items and the last reminder in words', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Accepted speakers' });
    const items = within(list).getAllByRole('listitem');
    // "Anything missing" leaves out the speaker who owes nothing.
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Missing: Headshot, Materials (Panel one).')).toBeInTheDocument();
    expect(within(items[0]).getByText('Not reminded yet.')).toBeInTheDocument();
    expect(within(items[1]).getByTestId('last-reminded-ben').textContent).toBe(
      'Last reminded Oct 18, 2026, 9:30 AM (UTC) about Session description. Can be reminded again after Oct 19, 2026, 9:30 AM (UTC).',
    );
    expect(within(items[1]).getByText('Approved')).toBeInTheDocument();
  });

  it('narrows by group, keeps the group in the address, and clears the selection', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lee' }));
    expect(screen.getByText('1 speaker selected')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'description' } });
    expect(screen.getByTestId('location').textContent).toBe('?show=description');
    expect(screen.getByText('No speakers selected')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Accepted speakers' })).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByRole('checkbox', { name: 'Ben Ode' })).toBeInTheDocument();
  });

  it('opens with the speaker named in the address selected', async () => {
    renderPage('/admin/speakers/reminders/send?speaker=cal');
    const box = await screen.findByRole('checkbox', { name: 'Cal Done' });
    expect(box).toBeChecked();
  });

  it('says why when nothing is selected, and asks the server for nothing', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview reminders' }));
    expect(await screen.findByText('Select at least one speaker to preview.')).toBeInTheDocument();
    expect(callsFor('preview')).toHaveLength(0);
  });

  it('exports the group on screen and says where the file went', async () => {
    serve({ export: { filename: 'speaker-readiness-any-2026-10-19.csv', csv: 'x', rowCount: 2 } });
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('button', { name: 'Export this list as CSV' }));
    expect(await screen.findByText(/Exported 2 speakers to speaker-readiness-any-2026-10-19.csv/)).toBeInTheDocument();
    expect(callsFor('export')).toEqual([{ action: 'export', group: 'any' }]);
    expect(saveTextFile).toHaveBeenCalledWith('speaker-readiness-any-2026-10-19.csv', 'x');
  });
});

describe('preview and send', () => {
  it('previews each message, confirms with the count, and sends the previewed batch', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lee' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ben Ode' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Biography' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview reminders' }));

    expect(await screen.findByText('1 speaker gets a reminder. 1 speaker gets none.')).toBeInTheDocument();
    const [previewCall] = callsFor('preview');
    expect(previewCall).toEqual({ action: 'preview', speakerIds: ['ada', 'ben'], topics: ['headshot', 'description', 'materials'] });
    expect(screen.getByRole('region', { name: 'Speakers who get no reminder' }).textContent).toContain(
      'Ben Ode: This speaker was reminded less than 24 hours ago.',
    );
    expect(screen.getByText('Items we still need for Example Event')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-preview-text').textContent).toBe(PREVIEW.recipients[0].text);
    const frame = screen.getByTitle('Reminder to ada@example.test');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('Hi Ada Lee, &lt;b&gt;');

    fireEvent.click(screen.getByRole('button', { name: 'Send 1 reminder' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Send 1 reminder?' })).toBeInTheDocument();
    expect(within(dialog).getByText(/This speaker gets one email now.*Ada Lee\./)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 1 reminder' }));

    expect(await screen.findByText('Sent 1 reminder.')).toBeInTheDocument();
    const [sendCall] = callsFor('send');
    expect(sendCall).toMatchObject({
      action: 'send',
      speakerIds: ['ada'],
      topics: ['headshot', 'description', 'materials'],
      confirmCount: 1,
      wordingVersion: 'wording-v1',
    });
    expect(typeof sendCall.batchId).toBe('string');
    expect(sendCall.batchId.length).toBeGreaterThanOrEqual(8);
    await waitFor(() => expect(callsFor('list')).toHaveLength(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a second press while sending sends nothing more, and a failure stays in the dialog', async () => {
    let finish;
    serve({ send: () => new Promise((resolve) => { finish = resolve; }) });
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview reminders' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 reminder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 1 reminder' }));
    const busy = await within(dialog).findByRole('button', { name: 'Sending…' });
    fireEvent.click(busy);
    expect(callsFor('send')).toHaveLength(1);
    finish({ batchId: 'x', sent: [], alreadySent: [], skipped: [], failed: [{ speakerId: 'ada', name: 'Ada Lee' }] });
    expect(await screen.findByText('Sent 0 reminders. 1 speaker could not be emailed. Preview again to retry.')).toBeInTheDocument();
  });

  it('a server refusal of the send is shown in the dialog', async () => {
    serve({ send: new Error('This historical demo is read-only. Account, feedback, and email actions are disabled.') });
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview reminders' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send 1 reminder' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 1 reminder' }));
    expect(await within(dialog).findByText(/historical demo is read-only/)).toBeInTheDocument();
  });

  it('a change to the items clears the preview', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Accepted speakers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Lee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview reminders' }));
    await screen.findByRole('button', { name: 'Send 1 reminder' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Materials' }));
    expect(screen.queryByRole('button', { name: 'Send 1 reminder' })).toBeNull();
  });
});

describe('reminder wording', () => {
  it('shows the server refusal of an unknown token and saves valid wording', async () => {
    serve({
      saveTemplate: (body) => {
        if (body.text.includes('{{nope}}')) throw new Error('text: unknown token {{nope}}');
        return { ...TEMPLATE, saved: { ...body, updatedAt: '2026-10-19T12:00:00.000Z', updatedBy: 'staff@example.test' } };
      },
    });
    renderPage();
    const text = await screen.findByLabelText('Plain text body');
    expect(screen.getByText('The shipped wording is in use.')).toBeInTheDocument();
    fireEvent.change(text, { target: { value: '{{dashboard_url}} {{nope}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
    expect(await screen.findByText('text: unknown token {{nope}}')).toBeInTheDocument();

    fireEvent.change(text, { target: { value: 'Open {{dashboard_url}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
    expect(await screen.findByText('Wording saved. The next preview and send use it.')).toBeInTheDocument();
    expect(screen.getByText(/Saved wording, last changed Oct 19, 2026, 12:00 PM \(UTC\) by staff@example.test\./)).toBeInTheDocument();
    expect(callsFor('saveTemplate').at(-1)).toEqual({
      action: 'saveTemplate',
      subject: TEMPLATE.shipped.subject,
      html: TEMPLATE.shipped.html,
      text: 'Open {{dashboard_url}}',
    });
    expect(screen.getByRole('button', { name: 'Use the shipped wording' })).toBeInTheDocument();
  });
});
