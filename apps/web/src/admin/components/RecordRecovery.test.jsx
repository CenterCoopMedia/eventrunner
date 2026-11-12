import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
const readVersions = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => readVersions }));
import RecordRecovery from './RecordRecovery.jsx';
import { DestructiveConfirm } from './formControls.jsx';

beforeEach(() => readVersions.mockReset());

function confirmation(collection = 'cmsPages') {
  render(<MemoryRouter><DestructiveConfirm trigger="Delete page" confirmLabel="Delete this page" consequence="The live record and draft are removed."
    permanence={<RecordRecovery collection={collection} docId="record" />} onConfirm={vi.fn()} /></MemoryRouter>);
}

describe('record recovery words', () => {
  it('checks history only after opening, and distinguishes an unpublished record from a restored draft with history', async () => {
    readVersions.mockResolvedValueOnce({ entries: [] }).mockResolvedValueOnce({ entries: [{ revision: 1 }] });
    confirmation();
    expect(readVersions).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete page' })));
    expect(screen.getByText(/has no published version and cannot be restored after deletion/)).toBeInTheDocument();
    expect(readVersions).toHaveBeenCalledExactlyOnceWith('cmsGetVersionHistory', { docPath: 'cmsPages/record', limit: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete page' })));
    expect(screen.getByText(/Published versions can be restored as a draft/)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be restored/)).toBeNull();
    expect(screen.getByText(/Unpublished edits are lost/)).toBeInTheDocument();
  });

  it.each([
    ['cmsSchedule', 'does not restore its materials'],
    ['cmsOrganizations', 'does not restore representative access or an edit'],
    ['cmsContent', 'only while its section is on a page'],
  ])('names the recovery limit for %s before deletion', async (collection, words) => {
    readVersions.mockResolvedValueOnce({ entries: [{ revision: 1 }] });
    confirmation(collection);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete page' })));
    expect(screen.getByText(new RegExp(words))).toBeInTheDocument();
  });

  it('does not claim irreversibility when the version read fails', async () => {
    readVersions.mockRejectedValueOnce(new Error('Offline'));
    confirmation();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete page' })));
    expect(screen.getByText(/If this record has a published version/)).toBeInTheDocument();
    expect(screen.queryByText(/has no published version/)).toBeNull();
  });
});
