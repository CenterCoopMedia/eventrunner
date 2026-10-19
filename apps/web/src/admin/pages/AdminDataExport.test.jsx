// AdminDataExport — the spreadsheets and the event data package (issue #329).
// Mocks the auth tier, adminApi, the text download, and the package fetch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import * as eventPackageCjs from '../../../../../functions/src/admin/eventPackage.cjs';
import * as dataExportCjs from '../../../../../functions/src/admin/dataExport.cjs';

let tier = 'staff';
vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ adminTier: tier, user: { getIdToken: async () => 'id-token' } }),
  functionsOrigin: () => 'https://fake-functions.example',
}));

const callMock = vi.fn();
vi.mock('../adminApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useAdminApi: () => callMock,
}));

const saveTextFileMock = vi.fn();
vi.mock('../downloadFile.js', () => ({ saveTextFile: (...args) => saveTextFileMock(...args) }));

const downloadMock = vi.fn();
vi.mock('../eventPackage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadEventPackage: (...args) => downloadMock(...args),
}));

const { default: AdminDataExport, SPREADSHEETS } = await import('./AdminDataExport.jsx');
const { PACKAGE_SECTIONS } = await import('../eventPackage.js');

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDataExport />
    </MemoryRouter>,
  );
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  callMock.mockReset();
  saveTextFileMock.mockReset();
  downloadMock.mockReset();
  tier = 'staff';
});

describe('AdminDataExport', () => {
  it('holds the page to the server: the same spreadsheets, tiers and package parts', () => {
    const { DATASETS } = dataExportCjs.internals;
    expect(SPREADSHEETS.map((sheet) => [sheet.dataset, sheet.tier])).toEqual(
      Object.entries(DATASETS).map(([name, dataset]) => [name, dataset.tier]),
    );
    expect(PACKAGE_SECTIONS.map((section) => section.id)).toEqual(eventPackageCjs.internals.SECTION_IDS);
    expect(PACKAGE_SECTIONS.map((section) => section.label)).toEqual(
      eventPackageCjs.internals.SECTIONS.map((section) => section.label),
    );
  });

  it('shows staff the three staff spreadsheets, and says who exports orders and the package', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Data export' })).toBeInTheDocument();
    for (const name of ['Export sessions', 'Export speakers', 'Export organizations and sponsors']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Export ticket orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export admissions' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Event data package' })).toBeNull();
    expect(screen.getByText('An operator exports ticket orders, admissions, and the event data package.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the Attendees page' })).toHaveAttribute('href', '/admin/attendees');
  });

  it('exports one spreadsheet, saves the file, and states the count and the audit in place', async () => {
    callMock.mockResolvedValueOnce({ filename: 'sessions-2026-10-01.csv', csv: '\uFEFF"Session ID"\r\n', rowCount: 12 });
    renderPage();
    const button = screen.getByRole('button', { name: 'Export sessions' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await settle();
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith('exportEventData', { dataset: 'sessions' });
    expect(saveTextFileMock).toHaveBeenCalledWith('sessions-2026-10-01.csv', '\uFEFF"Session ID"\r\n');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Exported 12 sessions to sessions-2026-10-01.csv. The export is in the admin log.',
    );
  });

  it('states a refusal in the server’s words and saves nothing', async () => {
    callMock.mockRejectedValueOnce(new Error('dataset: only an operator can export orders.'));
    tier = 'operator';
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export ticket orders' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('dataset: only an operator can export orders.');
    expect(saveTextFileMock).not.toHaveBeenCalled();
  });

  it('gives an operator orders, admissions, and the package with every part chosen and staff notes off', () => {
    tier = 'operator';
    renderPage();
    expect(screen.getByRole('button', { name: 'Export ticket orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export admissions' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: `Parts to include (8 of 8 chosen)` });
    for (const section of PACKAGE_SECTIONS) {
      expect(within(group).getByRole('checkbox', { name: section.label })).toBeChecked();
    }
    expect(screen.getByRole('checkbox', { name: 'Include staff notes on session pitches' })).not.toBeChecked();
    expect(screen.queryByText(/An operator exports/)).toBeNull();
    // The server builds every package file from live records (eventPackage.cjs datasetFile).
    expect(screen.getByText(/It holds live records only: no drafts\. A hidden record is in it and marked hidden\./)).toBeInTheDocument();
    expect(screen.getByText(/drafts included, with its state/)).toBeInTheDocument();
  });

  it('downloads the package with the parts and the staff-note choice the operator made', async () => {
    tier = 'operator';
    downloadMock.mockResolvedValueOnce({ filename: 'event-data-package-2026-10-01.zip', bytes: 2048 });
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ticket orders and admissions' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include staff notes on session pitches' }));
    expect(screen.getByRole('group', { name: 'Parts to include (7 of 8 chosen)' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Download event data package' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-busy', 'true');
    await settle();
    expect(downloadMock).toHaveBeenCalledTimes(1);
    const [args] = downloadMock.mock.calls[0];
    expect(args.sections).toEqual(['content', 'program', 'speakers', 'organizations', 'materials', 'attendees', 'pitches']);
    expect(args.includeStaffNotes).toBe(true);
    await expect(args.getIdToken()).resolves.toBe('id-token');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Downloaded event-data-package-2026-10-01.zip. The download is in the admin log.',
    );
  });

  it('says why when no part is chosen, and sends nothing', async () => {
    tier = 'operator';
    renderPage();
    for (const section of PACKAGE_SECTIONS) {
      fireEvent.click(screen.getByRole('checkbox', { name: section.label }));
    }
    const button = screen.getByRole('button', { name: 'Download event data package' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await settle();
    expect(downloadMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Choose at least one part to include.');
  });

  it('states a package refusal, such as a package too large for the page', async () => {
    tier = 'operator';
    downloadMock.mockRejectedValueOnce(new Error('This event is too large to package here. Run scripts/export-event-package.cjs from a terminal instead (docs/operator/archive-handoff.md).'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Download event data package' }));
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(/too large to package here/);
  });
});
