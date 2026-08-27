// ModalShell — the dialog shell the three media modals share.
//
// Elevation (design brief §2.1, §2.4): a modal is lifted by an ink-tinted
// scrim and a strong-rule frame, never a shadow. These assertions guard the
// look (no shadow-lg, the strong-rule frame is on the panel) alongside the
// behavior the shell is actually for (focus moves in on open, Escape
// closes, focus returns to the opener on close) so a future restyle cannot
// silently drop either.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ModalShell from './ModalShell.jsx';

describe('ModalShell', () => {
  it('lifts the panel with a strong-rule frame, never a shadow', () => {
    render(
      <ModalShell title="Upload a file" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass('border-strong', 'border-rule-strong');
    expect(panel.className).not.toContain('shadow');
  });

  it('tints the overlay with ink, with no blur', () => {
    const { container } = render(
      <ModalShell title="Upload a file" onClose={() => {}}>
        <p>Body</p>
      </ModalShell>,
    );
    const overlay = container.firstChild;
    expect(overlay).toHaveClass('bg-brand-ink/40');
    expect(overlay.className).not.toMatch(/blur/);
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
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
