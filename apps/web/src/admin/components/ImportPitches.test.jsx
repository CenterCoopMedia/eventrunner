import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImportPitches from './ImportPitches.jsx';

async function choose(contents) {
  const file = new File([contents], 'Proposals.csv', { type: 'text/csv' });
  file.text = async () => contents;
  fireEvent.change(screen.getByLabelText('Proposal CSV'), { target: { files: [file] } });
  await screen.findByLabelText('Reference');
}
const csv = 'Reference,Email,Title,Description,Organization,Format,Consent\npitch-1,ada@example.test,Opening,A useful session.,Newsroom,Talk,true';

describe('pitch column matching', () => {
  it('imports readable columns only after review with the existing payload', async () => {
    const call = vi.fn().mockResolvedValue({ imported: 1, unchanged: 0 });
    render(<ImportPitches call={call} />);
    await choose(csv);
    expect(screen.getByLabelText('Source name')).toHaveValue('Proposals');
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these proposals/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][0]).toBe('importSessionPitches');
    expect(call.mock.calls[0][1].rows[0]).not.toHaveProperty('leadName');
    expect(call.mock.calls[0][1].rows[0]).not.toHaveProperty('accessNeeds');
    expect(call.mock.calls[0][1]).toMatchObject({ source: 'Proposals', rows: [{ externalId: 'pitch-1', email: 'ada@example.test', title: 'Opening', description: 'A useful session.', consent: true }] });
  });
  it('invalidates a reviewed preview after changing a mapped column', async () => {
    const call = vi.fn();
    render(<ImportPitches call={call} />);
    await choose(csv);
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these proposals/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the column for title.');
    expect(call).not.toHaveBeenCalled();
  });
});
