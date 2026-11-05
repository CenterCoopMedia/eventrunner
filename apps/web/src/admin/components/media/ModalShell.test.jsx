// ModalShell — the dialog shell the three media modals share.
//
// Elevation (admin story part 6, brief §5.2 open question 4): a modal is
// lifted by an ink-tinted scrim and a strong-rule frame, never a shadow.
// These assertions guard the look (no shadow class, the strong-rule frame is
// on the panel) alongside the behavior the shell is actually for (focus
// moves in on open, Escape closes, focus returns to the opener on close) so
// a future restyle cannot silently drop either.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ModalShell from './ModalShell.jsx';
import { DestructiveConfirm } from '../formControls.jsx';

describe('ModalShell', () => {
  it('lifts the panel with a strong-rule frame, never a shadow', () => {
    render(
      <ModalShell title="Upload a file" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass('border-admin-strong', 'border-admin-rule-strong');
    expect(panel.className).not.toContain('shadow');
  });

  it('opens a native modal so the background is inert', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(
      <ModalShell title="Upload a file" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveClass('admin-modal');
    expect(showModal).toHaveBeenCalledTimes(1);
    showModal.mockRestore();
  });

  it('labels the dialog by its own heading and shows the description', () => {
    render(
      <ModalShell title="Upload a file" description="PNG, JPEG, or WEBP" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Upload a file' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('PNG, JPEG, or WEBP')).toBeInTheDocument();
  });

  it('moves focus into the panel on open and returns it to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = render(
      <ModalShell title="Upload a file" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    expect(screen.getByRole('dialog')).toHaveFocus();

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('closes on Escape and on the Close button', () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="Upload a file" onClose={onClose}>
        <p>Body</p>
      </ModalShell>,
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps a pending write open for both Escape and the close control', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ModalShell title="Upload" busy onClose={onClose}>Uploading…</ModalShell>);
    const dialog = screen.getByRole('dialog');
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    rerender(<ModalShell title="Upload" onClose={onClose}>Upload failed. Try again.</ModalShell>);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('wraps both keyboard boundaries and skips disabled controls', () => {
    render(<ModalShell title="Details" onClose={() => {}}><button disabled>Unavailable</button><button>Done</button></ModalShell>);
    const close = screen.getByRole('button', { name: 'Close' });
    const done = screen.getByRole('button', { name: 'Done' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(done).toHaveFocus();
    fireEvent.keyDown(done, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(done).toHaveFocus();
  });

  it('uses a connected fallback after the original asset control disappears', () => {
    const opener = document.createElement('button');
    const fallback = document.createElement('input');
    document.body.append(opener, fallback);
    opener.focus();
    const { unmount } = render(<ModalShell title="Details" onClose={() => {}} returnFocusRef={{ current: fallback }}>File</ModalShell>);
    opener.remove();
    unmount();
    expect(fallback).toHaveFocus();
    fallback.remove();
  });

  it('leaves native Tab order intact from a focused consequence inside the dialog', () => {
    render(<ModalShell title="Details" onClose={() => {}}>
      <button>Save description</button>
      <DestructiveConfirm trigger="Delete file" title="Delete file" confirmLabel="Delete file" consequence="This removes the file." onConfirm={vi.fn()} />
    </ModalShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    const heading = screen.getByRole('heading', { name: 'Delete file' });
    expect(heading).toHaveFocus();
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      fireEvent(heading, tab);
      expect(tab.defaultPrevented).toBe(false);
    }
  });

  it('names the icon-only close control and returns focus after dismissal', () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Choose image</button>
          {open ? (
            <ModalShell title="Choose an image — Primary logo" onClose={() => setOpen(false)}>
              Images
            </ModalShell>
          ) : null}
        </>
      );
    }
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Choose image' });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveTextContent('');
    expect(close).toHaveAttribute('title', 'Close dialog');
    expect(close.className).toContain('shrink-0');
    expect(close.className).toContain('min-w-[var(--admin-control-height)]');
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    close.focus();
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
