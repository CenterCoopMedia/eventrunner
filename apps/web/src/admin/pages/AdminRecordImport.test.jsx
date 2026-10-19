// AdminRecordImport: the staff CSV import for speakers, sessions and
// organizations. Mocks adminApi directly (the AdminTicketing.test.jsx
// convention): the server contract is what matters, not the transport.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));
const saveMock = vi.fn();
vi.mock('../downloadFile.js', () => ({ saveTextFile: (...args) => saveMock(...args) }));

import AdminRecordImport from './AdminRecordImport.jsx';

const SPEAKER_CSV = 'external_id,first_name,last_name,email,phone\nSPK-1,Ada,Lovelace,ada@example.com,555-0100\nSPK-2,Grace,Hopper,,555-0101\n';

const PREVIEW = {
  ok: true,
  type: 'speakers',
  dryRun: true,
  digest: 'a'.repeat(64),
  total: 2,
  summary: { create: 1, update: 0, unchanged: 0, error: 1 },
  rows: [
    { index: 0, verdict: 'create', externalId: 'SPK-1', label: 'Ada Lovelace', changedFields: [], reasons: [], notes: [] },
    { index: 1, verdict: 'error', externalId: 'SPK-2', label: 'Grace Hopper', changedFields: [], reasons: ['slug: "grace-hopper" is already used by another speaker.'], notes: [] },
  ],
};

function csvFile(text, name = 'speakers.csv') {
  const file = new File([text], name, { type: 'text/csv' });
  if (typeof file.text !== 'function') file.text = async () => text;
  return file;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminRecordImport />
    </MemoryRouter>,
  );
}

async function chooseFile(text) {
  const input = screen.getByLabelText('CSV file');
  await act(async () => {
    fireEvent.change(input, { target: { files: [csvFile(text)] } });
    await Promise.resolve();
  });
}

describe('AdminRecordImport', () => {
  beforeEach(() => {
    callMock.mockReset();
    saveMock.mockReset();
  });

  it('names the page and says the import writes drafts and sends no email', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Import records' })).toBeInTheDocument();
    expect(screen.getByText(/saves drafts only\. It publishes nothing and sends no email\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Record type')).toHaveValue('speakers');
  });

  it('downloads the template for the chosen record type', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'sessions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download the session template' }));
    expect(saveMock).toHaveBeenCalledTimes(1);
    const [name, text] = saveMock.mock.calls[0];
    expect(name).toBe('sessions-import-template.csv');
    expect(text.split('\n')[0]).toBe('external_id,title,description,day,start_time,end_time,track,place,location,recording_url,speakers,session_id');
  });

  it('maps the template headers, previews with dryRun, and sends only the mapped columns', async () => {
    callMock.mockResolvedValueOnce(PREVIEW);
    renderPage();
    await chooseFile(SPEAKER_CSV);
    expect(await screen.findByText('speakers.csv · 2 rows')).toBeInTheDocument();
    expect(screen.getByLabelText('External ID (required)')).toHaveValue('external_id');
    expect(screen.getByLabelText('First name')).toHaveValue('first_name');
    expect(screen.getByLabelText('Bio')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    const [name, body] = callMock.mock.calls[0];
    expect(name).toBe('importRecordsCsv');
    expect(body).toMatchObject({ type: 'speakers', dryRun: true });
    expect(body.mapping).toEqual({ externalId: 'external_id', firstName: 'first_name', lastName: 'last_name', email: 'email' });
    expect(body.rows[0]).toEqual({ external_id: 'SPK-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' });
    expect(JSON.stringify(body.rows)).not.toContain('555-0100');

    const table = await screen.findByRole('region', { name: /Preview: speakers/ });
    expect(within(table).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(table).getByText('New')).toBeInTheDocument();
    expect(within(table).getByText('Error')).toBeInTheDocument();
    expect(within(table).getByText(/is already used by another speaker/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preview: 1 new, 0 updates, 0 no change, 1 error. Nothing is saved yet.');
    expect(screen.getByRole('button', { name: 'Import 1 speaker as drafts' })).toBeInTheDocument();
  });

  it('imports only on confirmation, sending the preview digest, and reports the drafts', async () => {
    callMock.mockResolvedValueOnce(PREVIEW);
    callMock.mockResolvedValueOnce({ ...PREVIEW, dryRun: false });
    renderPage();
    await chooseFile(SPEAKER_CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    const confirm = await screen.findByRole('button', { name: 'Import 1 speaker as drafts' });
    expect(callMock).toHaveBeenCalledTimes(1);

    fireEvent.click(confirm);
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(2));
    expect(callMock.mock.calls[1][1]).toMatchObject({ type: 'speakers', dryRun: false, confirmDigest: 'a'.repeat(64) });
    expect(callMock.mock.calls[1][1].rows).toEqual(callMock.mock.calls[0][1].rows);

    expect(await screen.findByText(/Imported: 1 new, 0 updates, 0 no change, 1 error\. New speakers are drafts\. Invite or approve them on the Speakers page\./)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Result: speakers/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open speakers' })).toHaveAttribute('href', '/admin/speakers');
    expect(screen.queryByRole('button', { name: /as drafts/ })).not.toBeInTheDocument();
  });

  it('says why it cannot preview when a required field is not mapped, and calls nothing', async () => {
    renderPage();
    await chooseFile('code,full\nx,Ada Lovelace\n');
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Map a column to External ID.');
    expect(callMock).not.toHaveBeenCalled();
  });

  it('drops the preview when the mapping changes, so a stale preview cannot be confirmed', async () => {
    callMock.mockResolvedValueOnce(PREVIEW);
    renderPage();
    await chooseFile(SPEAKER_CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByRole('button', { name: 'Import 1 speaker as drafts' });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: '' } });
    expect(screen.queryByRole('button', { name: /as drafts/ })).not.toBeInTheDocument();
  });

  it('shows a refused confirm verbatim and asks for a new preview', async () => {
    callMock.mockResolvedValueOnce(PREVIEW);
    const refused = Object.assign(new Error('The file or the column mapping changed after the preview. Preview the import again.'), { status: 409 });
    callMock.mockRejectedValueOnce(refused);
    renderPage();
    await chooseFile(SPEAKER_CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 speaker as drafts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview the import again.');
    expect(screen.queryByRole('button', { name: /as drafts/ })).not.toBeInTheDocument();
  });

  it('offers no import when every row is unchanged or has an error, and says why', async () => {
    callMock.mockResolvedValueOnce({ ...PREVIEW, summary: { create: 0, update: 0, unchanged: 2, error: 0 } });
    renderPage();
    await chooseFile(SPEAKER_CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText('Nothing to import. Every row is unchanged or has an error.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as drafts/ })).not.toBeInTheDocument();
  });

  it('says a change to a published speaker waits for review, and names a matched record', async () => {
    callMock.mockResolvedValueOnce({
      ...PREVIEW,
      summary: { create: 0, update: 1, unchanged: 0, error: 0 },
      rows: [{
        index: 0,
        verdict: 'update',
        matched: true,
        externalId: 'SPK-1',
        label: 'Ada Lovelace',
        changedFields: ['bio'],
        reasons: [],
        notes: ['Matches the existing speaker "ada-lovelace" by its slug.'],
      }],
    });
    renderPage();
    await chooseFile(SPEAKER_CSV);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    const preview = await screen.findByRole('region', { name: /Preview: speakers/ });
    expect(within(preview).getByText('Matches existing')).toBeInTheDocument();
    expect(within(preview).getByText(/Matches the existing speaker "ada-lovelace"/)).toBeInTheDocument();
    expect(screen.getByText(/A change to a published speaker waits for review on the Speakers page\./)).toBeInTheDocument();
  });

  it('refuses a file over the size limit without reading it', async () => {
    renderPage();
    const text = vi.fn(async () => '');
    const input = screen.getByLabelText('CSV file');
    await act(async () => {
      fireEvent.change(input, { target: { files: [{ name: 'huge.csv', size: 6 * 1024 * 1024, text }] } });
      await Promise.resolve();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is larger than 5 MB. Split the file.');
    expect(text).not.toHaveBeenCalled();
  });

  it('refuses a file over the row limit before sending it', async () => {
    renderPage();
    const rows = Array.from({ length: 501 }, (_, i) => `S-${i},A,B`).join('\n');
    await chooseFile(`external_id,first_name,last_name\n${rows}\n`);
    expect(await screen.findByRole('alert')).toHaveTextContent('That file has 501 rows. Import at most 500 rows at a time.');
    expect(screen.queryByRole('button', { name: 'Preview import' })).not.toBeInTheDocument();
  });

  it('re-maps the file when the record type changes', async () => {
    renderPage();
    await chooseFile('external_id,title,name\nX,Keynote,Foundation\n');
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'organizations' } });
    expect(screen.getByLabelText('Name (required)')).toHaveValue('name');
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'sessions' } });
    expect(screen.getByLabelText('Title (required)')).toHaveValue('title');
  });
});
