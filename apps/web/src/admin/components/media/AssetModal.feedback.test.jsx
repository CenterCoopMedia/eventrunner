import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssetModal from './AssetModal.jsx';
import UploadModal from './UploadModal.jsx';
import { subscribeAdminDoc } from '../../adminSource.js';

vi.mock('../../adminSource.js', async (importOriginal) => ({
  ...await importOriginal(),
  subscribeAdminDoc: vi.fn(),
}));

const asset = {
  id: 'file-1', path: 'cms-images/file-1/venue.png', filename: 'venue.png',
  title: 'Venue', alt: 'Meeting room', size: 2048, contentType: 'image/png',
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('media action feedback', () => {
  it('distinguishes a failed usage check from loading and retries before enabling deletion', async () => {
    const scanUsage = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ [asset.path]: [] });
    const remove = vi.fn();
    render(<AssetModal asset={asset} operator onClose={vi.fn()} scanUsage={scanUsage} updateMetadata={vi.fn()} remove={remove} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Usage could not be checked');
    expect(screen.queryByText('Checking usage…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this file' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry usage check' }));
    await screen.findByText('This file is not used in your event.');
    expect(screen.getByRole('button', { name: 'Delete this file' })).toBeEnabled();
    expect(scanUsage).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps deletion failure beside its confirmation and keeps the request identity clear', async () => {
    const request = deferred();
    const remove = vi.fn(() => request.promise);
    const onClose = vi.fn();
    const updateMetadata = vi.fn();
    render(<AssetModal asset={asset} operator onClose={onClose} scanUsage={vi.fn().mockResolvedValue({ [asset.path]: [] })} updateMetadata={updateMetadata} remove={remove} />);
    await screen.findByText('This file is not used in your event.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(save);
    expect(updateMetadata).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('storage/internal: cmsPages/home')));
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent('The file could not be deleted. Try again.');
    expect(failure).not.toHaveTextContent('storage/internal');
    expect(failure.closest('section')).toHaveTextContent('Where this is used');
    expect(screen.getByRole('button', { name: 'Delete this file' })).toBeEnabled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('locks the submitted description until its save resolves and clears Saved after another edit', async () => {
    const request = deferred();
    const updateMetadata = vi.fn(() => request.promise);
    render(<AssetModal asset={asset} operator onClose={vi.fn()} scanUsage={vi.fn().mockResolvedValue({ [asset.path]: [] })} updateMetadata={updateMetadata} remove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Image description'), { target: { value: 'A bright meeting room' } });
    const form = screen.getByRole('button', { name: 'Save' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByLabelText('Image description')).toBeDisabled();
    expect(updateMetadata).toHaveBeenCalledOnce();
    await act(async () => request.resolve({}));
    expect(await screen.findByText('Description saved.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Image description'), { target: { value: 'Another description' } });
    expect(screen.queryByText('Description saved.')).not.toBeInTheDocument();
  });

  it('lets the editor review both revisions and retry the same replacement after a partial result', async () => {
    const published = { docPath: 'cmsContent/travel__image', field: 'url', label: 'Travel image' };
    const draft = { ...published, docPath: 'cmsContent_drafts/travel__image' };
    const references = [published, draft];
    const scanUsage = vi.fn().mockResolvedValue({ [asset.path]: references });
    const replace = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', changed: [published], failed: [{ ...draft, reason: 'Draft could not be saved.' }] })
      .mockResolvedValueOnce({ status: 'done', changed: references, failed: [] });
    const replacement = { id: 'file-2', path: 'cms-images/file-2/arrival.png', title: 'New arrival photo' };
    render(<AssetModal asset={asset} operator onClose={vi.fn()} scanUsage={scanUsage} updateMetadata={vi.fn()}
      remove={vi.fn()} replace={replace} renderReplacementPicker={({ onSelect }) => (
        <button type="button" onClick={() => onSelect(replacement)}>Choose new arrival photo</button>
      )} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Replace this image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose new arrival photo' }));
    await screen.findByText(/Published · url/);
    expect(screen.getByText(/Draft · url/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Also delete the original file' })).not.toBeChecked();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep the current description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }));
    expect(await screen.findByText('Draft could not be saved.')).toBeInTheDocument();
    const [id, input] = replace.mock.calls[0];
    expect(input).toMatchObject({ assetId: asset.id, replacementId: replacement.id, keepDescription: true, deleteOriginal: false, references });
    fireEvent.click(screen.getByRole('button', { name: 'Retry replacement' }));
    expect(await screen.findByText('2 places changed.')).toBeInTheDocument();
    expect(replace).toHaveBeenNthCalledWith(2, id, input);
  });

  it('requires a separate permanent deletion confirmation after the editor opts in', async () => {
    const place = { docPath: 'cmsContent/hero__image', field: 'url' };
    const scanUsage = vi.fn().mockResolvedValue({ [asset.path]: [place] });
    const outcome = { queueId: 'receipt', status: 'done', changed: [place], failed: [] };
    const replace = vi.fn().mockResolvedValue({
      ...outcome, deletion: { status: 'waiting-for-site', message: 'The original stays while the site updates.' },
    });
    let onReceipt;
    subscribeAdminDoc.mockImplementation((path, onNext) => {
      expect(path).toBe('cmsPublishQueue/receipt');
      onReceipt = onNext;
      return vi.fn();
    });
    const replacement = { id: 'file-2', path: 'cms-images/file-2/new.png', title: 'New venue photo' };
    render(<AssetModal asset={asset} operator onClose={vi.fn()} scanUsage={scanUsage} updateMetadata={vi.fn()}
      remove={vi.fn()} replace={replace} renderReplacementPicker={({ onSelect }) => (
        <button type="button" onClick={() => onSelect(replacement)}>Choose new venue photo</button>
      )} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Replace this image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose new venue photo' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Also delete the original file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review permanent deletion' }));
    expect(screen.getByText(/Deleting the original cannot be undone/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Replace and delete original' }));
    await screen.findByText('The original stays while the site updates.');
    expect(replace).toHaveBeenCalledOnce();
    await act(async () => onReceipt({ mediaReplacement: { deletion: { status: 'deleted', message: 'The original file was deleted.' } } }));
    expect(await screen.findByText('The original file was deleted.')).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deleteOriginal: true }));
    expect(replace).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Delete this file anyway' })).not.toBeInTheDocument();
  });

  it('keeps upload inputs and dismissal consistent during a delayed upload', async () => {
    const request = deferred();
    const upload = vi.fn(() => request.promise);
    const onClose = vi.fn();
    const onUploaded = vi.fn();
    render(<UploadModal folder="cms-images" upload={upload} onClose={onClose} onUploaded={onUploaded} />);
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [new File(['x'], 'room.png', { type: 'image/png' })] } });
    const form = screen.getByRole('button', { name: 'Upload' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(upload).toHaveBeenCalledOnce();
    for (const label of ['File', 'Image description', 'Title (optional)']) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Upload interrupted')));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The file could not be uploaded. Try again.');
    expect(screen.getByLabelText('File')).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
