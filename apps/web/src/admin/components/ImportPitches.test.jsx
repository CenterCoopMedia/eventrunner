import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImportPitches from './ImportPitches.jsx';

const CSV = 'externalId,email,title,description,organization,format,consent\nrec-17,one@example.test,Local together,Serve readers.,,Panel,checked';
const ACKNOWLEDGEMENT = 'I reviewed these proposals and verified consent in the source form';
function file(text, name = 'proposals.csv') {
  return { name, size: text.length, text: async () => text };
}
async function choose(chosen) {
  await act(async () => { fireEvent.change(screen.getByLabelText('Proposal CSV'), { target: { files: [chosen] } }); });
}
function start(call = vi.fn()) {
  render(<ImportPitches call={call} />);
  fireEvent.change(screen.getByLabelText('Source name'), { target: { value: 'source-form' } });
  return call;
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Review proposals' }));
}

describe('guided proposal import', () => {
  it('imports the reviewed noncanonical columns with the original ID and no unmatched source data', async () => {
    const call = start(vi.fn().mockResolvedValue({ imported: 1, unchanged: 0 }));
    await choose(file('Idea,Record,Contact,Answer,Agreement,Private\nLocal together,rec-17,one@example.test,Serve readers.,checked,Do not import'));
    for (const [label, value] of [['Source ID', 'Record'], ['Email', 'Contact'], ['Proposal title', 'Idea'], ['Description', 'Answer'], ['Consent', 'Agreement']]) {
      fireEvent.change(screen.getByLabelText(`${label} (required)`), { target: { value } });
    }
    review();
    expect(screen.getByText('Local together')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import reviewed proposals' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(ACKNOWLEDGEMENT));
    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed proposals' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 pitch added. 0 were already here. No emails were sent.'));
    expect(call).toHaveBeenCalledWith('importSessionPitches', { source: 'source-form', rows: [
      { externalId: 'rec-17', email: 'one@example.test', title: 'Local together', description: 'Serve readers.', organization: '', format: '', consent: true },
    ] });
  });

  it('requires a new review and consent after changing the source, mapping or file', async () => {
    const call = start();
    await choose(file(CSV));
    review(); fireEvent.click(screen.getByLabelText(ACKNOWLEDGEMENT));
    fireEvent.change(screen.getByLabelText('Source name'), { target: { value: 'another-source' } });
    expect(screen.queryByRole('button', { name: 'Import reviewed proposals' })).not.toBeInTheDocument();
    review(); expect(screen.getByLabelText(ACKNOWLEDGEMENT)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: '' } });
    expect(screen.queryByLabelText(ACKNOWLEDGEMENT)).not.toBeInTheDocument();
    review(); fireEvent.click(screen.getByLabelText(ACKNOWLEDGEMENT));
    await choose(file(CSV.replace('rec-17', 'rec-18'), 'second.csv'));
    expect(screen.queryByLabelText(ACKNOWLEDGEMENT)).not.toBeInTheDocument();
    review(); expect(screen.getByText(/rec-18/)).toBeInTheDocument();
    expect(screen.getByLabelText(ACKNOWLEDGEMENT)).not.toBeChecked();
    expect(call).not.toHaveBeenCalled();
  });

  it('keeps the later file when an earlier read completes last', async () => {
    start();
    let finishFirst;
    const first = { name: 'first.csv', size: 100, text: () => new Promise((resolve) => { finishFirst = resolve; }) };
    await choose(first);
    await choose(file(CSV.replace('rec-17', 'rec-18'), 'second.csv'));
    await act(async () => { finishFirst(CSV); });
    expect(screen.getByText('second.csv · 1 proposal')).toBeInTheDocument();
    review(); expect(screen.getByText(/rec-18/)).toBeInTheDocument();
    expect(screen.queryByText(/rec-17/)).not.toBeInTheDocument();
  });

  it('refuses duplicate matches before review and keeps the server boundary unused', async () => {
    const call = start();
    await choose(file(CSV));
    fireEvent.change(screen.getByLabelText('Proposal title (required)'), { target: { value: 'description' } });
    review();
    expect(screen.getByRole('alert')).toHaveTextContent('matched more than once');
    expect(screen.queryByLabelText(ACKNOWLEDGEMENT)).not.toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
  });
});
