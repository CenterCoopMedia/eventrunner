import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { copyTextToClipboard } from '../lib/clipboard.js';
import ShareLink from './ShareLink.jsx';

vi.mock('../lib/clipboard.js', () => ({ copyTextToClipboard: vi.fn() }));

const target = { path: '/schedule/session-one', title: 'Session one' };
const url = 'http://localhost:3000/schedule/session-one';

beforeEach(() => {
  vi.mocked(copyTextToClipboard).mockReset().mockResolvedValue(true);
  vi.stubGlobal('navigator', {});
});
afterEach(() => vi.unstubAllGlobals());

it('calls native share synchronously from the press with the public URL and title', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share });
  render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
  // No promise or network read may precede the browser API call.
  expect(share).toHaveBeenCalledWith({ title: 'Session one', url });
  expect(copyTextToClipboard).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share link' })).not.toHaveAttribute('aria-busy', 'true'));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

it('copies directly when the browser has no share API and announces success', async () => {
  render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(copyTextToClipboard).toHaveBeenCalledWith(url);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied.'));
});

it('keeps keyboard focus and refuses a second press while a sheet is open', async () => {
  let close;
  const share = vi.fn(() => new Promise((resolve) => { close = resolve; }));
  vi.stubGlobal('navigator', { share });
  render(<ShareLink {...target} />);
  const button = screen.getByRole('button', { name: 'Share link' });
  button.focus();
  fireEvent.click(button);
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(button);
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => close());
  expect(button).toHaveFocus();
  expect(button).not.toHaveAttribute('aria-busy', 'true');
});

it('keeps a dismissed share sheet silent and does not copy behind it', async () => {
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')) });
  render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Share link' })).not.toHaveAttribute('aria-busy', 'true'));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(copyTextToClipboard).not.toHaveBeenCalled();
});

it('offers a fresh copy press after a real share failure', async () => {
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('Unavailable', 'NotAllowedError')) });
  render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
  const copy = await screen.findByRole('button', { name: 'Copy link' });
  expect(screen.getByRole('status')).toHaveTextContent('Sharing is unavailable. Copy the link instead.');
  expect(copyTextToClipboard).not.toHaveBeenCalled();
  fireEvent.click(copy);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied.'));
});

it('offers selectable text when both clipboard methods fail', async () => {
  vi.mocked(copyTextToClipboard).mockResolvedValue(false);
  render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  const field = await screen.findByRole('textbox', { name: 'Link to copy' });
  expect(field).toHaveValue(url);
  expect(field).toHaveAttribute('readonly');
  field.focus();
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(url.length);
});

it('does not show an old copy answer on a different public target', async () => {
  let finish;
  vi.mocked(copyTextToClipboard).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<ShareLink {...target} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  view.rerender(<ShareLink path="/schedule/next" title="Next session" />);
  await act(async () => finish(true));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(copyTextToClipboard).toHaveBeenLastCalledWith('http://localhost:3000/schedule/next'));
});
