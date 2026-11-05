import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssetModal from './AssetModal.jsx';
import UploadModal from './UploadModal.jsx';

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
    await screen.findByText(/Deleting it is safe/);
    expect(screen.getByRole('button', { name: 'Delete this file' })).toBeEnabled();
    expect(scanUsage).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps deletion failure beside its confirmation and keeps the request identity clear', async () => {
    const request = deferred();
    const remove = vi.fn(() => request.promise);
    const onClose = vi.fn();
    render(<AssetModal asset={asset} operator onClose={onClose} scanUsage={vi.fn().mockResolvedValue({ [asset.path]: [] })} updateMetadata={vi.fn()} remove={remove} />);
    await screen.findByText(/Deleting it is safe/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('The connection was interrupted.')));
    const failure = await screen.findByRole('alert');
    expect(failure.closest('section')).toHaveTextContent('Where this is used');
    expect(screen.getByRole('button', { name: 'Delete this file' })).toBeEnabled();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('locks the submitted description until its save resolves and clears Saved after another edit', async () => {
    const request = deferred();
    const updateMetadata = vi.fn(() => request.promise);
    render(<AssetModal asset={asset} operator onClose={vi.fn()} scanUsage={vi.fn().mockResolvedValue({ [asset.path]: [] })} updateMetadata={updateMetadata} remove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'A bright meeting room' } });
    const form = screen.getByRole('button', { name: 'Save description' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByLabelText('Alt text')).toBeDisabled();
    expect(updateMetadata).toHaveBeenCalledOnce();
    await act(async () => request.resolve({}));
    expect(await screen.findByText('Description saved.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Another description' } });
    expect(screen.queryByText('Description saved.')).not.toBeInTheDocument();
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
    for (const label of ['File', 'Alt text', 'Title (optional)']) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Upload interrupted')));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('File')).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });
});
