import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import BusyLabel from './BusyLabel.jsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(milliseconds) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

// A real control that holds focus while busy: aria-disabled, never disabled.
function SaveControl({ save }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  async function press() {
    if (busy) return;
    setBusy(true);
    try {
      setResult(await save());
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" aria-busy={busy || undefined} aria-disabled={busy || undefined} onClick={press}>
        <BusyLabel busy={busy} pending="Saving the session…">Save</BusyLabel>
      </button>
      <p>{result}</p>
    </>
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const announcer = () => document.body.querySelector(':scope > [data-announcer]');

describe('BusyLabel', () => {
  it('names the work from the press, says it is late at ten seconds, and rests when the work ends', async () => {
    const request = deferred();
    const save = vi.fn(() => request.promise);
    render(<SaveControl save={save} />);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();

    fireEvent.click(button);
    expect(button).toHaveAccessibleName('Saving the session…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    // The empty region is in place from the press, before it has a line.
    expect(announcer()).toBeInTheDocument();
    expect(announcer().textContent).toBe('');

    advance(9999);
    expect(button).toHaveAccessibleName('Saving the session…');
    expect(announcer().textContent).toBe('');

    advance(1);
    expect(button).toHaveAccessibleName('Still saving the session…');
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    expect(announcer()).toHaveTextContent('Still saving the session. This is taking longer than usual.');
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => request.resolve('Session saved.'));
    expect(button).toHaveAccessibleName('Save');
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Session saved.')).toBeInTheDocument();
    expect(announcer()).toHaveTextContent('');
    expect(document.activeElement).toBe(button);
  });

  it('announces the late line once while the work continues', () => {
    const request = deferred();
    render(<SaveControl save={() => request.promise} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    advance(10000);
    const region = announcer();
    const changes = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    advance(60000);
    observer.disconnect();
    expect(changes).toHaveLength(0);
    expect(document.querySelectorAll('[data-announcer]')).toHaveLength(1);
  });

  it('holds the pending words as the width while the late words wrap inside it', () => {
    render(
      <BusyLabel busy pending="Saving the session…">Save</BusyLabel>,
    );
    advance(10000);
    const late = screen.getByText('Still saving the session…');
    expect(late).toHaveClass('w-0', 'min-w-full');
    expect(screen.getByText('Saving the session…')).toHaveClass('invisible');
    expect(screen.getByText('Save')).toHaveClass('invisible');
  });

  it('starts a fresh ten seconds for the next press', async () => {
    let request = deferred();
    render(<SaveControl save={() => request.promise} />);
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    advance(10000);
    await act(async () => request.resolve('Saved.'));
    request = deferred();
    fireEvent.click(button);
    expect(button).toHaveAccessibleName('Saving the session…');
    advance(9999);
    expect(button).toHaveAccessibleName('Saving the session…');
  });

  it('announces inside the open modal dialog that holds the control', () => {
    const request = deferred();
    render(<dialog open aria-label="Confirm"><SaveControl save={() => request.promise} /></dialog>);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    advance(10000);
    const region = dialog.querySelector('[data-announcer]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Still saving the session. This is taking longer than usual.');
  });
});
