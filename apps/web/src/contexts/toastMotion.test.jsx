// The toast: its tone, what it announces, and where its motion is allowed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, TOAST_EXIT_MS, useToast } from './ToastContext.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(path.resolve(here, '..', 'generated', 'theme.css'), 'utf8');

/** A button that raises one toast, so a test can drive the provider. */
function Raise({ message = 'Draft saved.', options }) {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast(message, options)}>
      Raise
    </button>
  );
}

/** Render the provider, optionally inside the admin room. */
function setup({ admin = false, ...props } = {}) {
  const tree = <ToastProvider><Raise {...props} /></ToastProvider>;
  return render(admin ? <div className="admin-room">{tree}</div> : tree);
}

function raise() {
  fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the toast', () => {
  it('states its tone in a word, never in colour alone', () => {
    setup({ options: { tone: 'error' }, message: 'The bookmark could not be saved.' });
    raise();
    const bar = screen.getByRole('alert');
    expect(bar).toHaveTextContent('Problem');
    expect(bar).toHaveTextContent('The bookmark could not be saved.');
  });

  it('draws its tone as a rule weight, not as a tone colour', () => {
    setup();
    raise();
    const bar = screen.getByRole('status');
    // The rule is the reversed ink the bar already carries. A tone colour
    // here would be the coloured edge the brief rejects.
    expect(bar.className).toContain('border-hairline');
    expect(bar.className).toContain('border-surface');
    expect(bar.className).not.toMatch(/border-danger|border-success|border-warning/);
  });

  it('announces a result nothing else states', () => {
    setup();
    raise();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('stays silent when it only repeats a line the page already states', () => {
    // One result, announced once: the in-place role="status" line owns the
    // announcement and the bar is the visual repeat.
    setup({ options: { announce: false } });
    raise();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Draft saved.')).toBeInTheDocument();
  });

  it('enters on the public surface', () => {
    setup();
    raise();
    expect(screen.getByRole('status').className).toContain('motion-enter');
  });

  it('carries no motion at all inside the admin room', () => {
    // The admin has no enter, no exit and no press: a state change in the
    // room is instant (design brief §2.2).
    setup({ admin: true });
    raise();
    const bar = screen.getByRole('status');
    expect(bar.className).not.toMatch(/motion-enter|motion-exit|animate-|transition-|duration-/);
  });

  it('exits before it is removed, and then it is gone', () => {
    setup();
    raise();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByRole('status').className).toContain('motion-exit');
    act(() => {
      vi.advanceTimersByTime(TOAST_EXIT_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('holds the bar exactly as long as the exit step lasts', () => {
    // The CSS runs the fade and the timer holds the element. A token that
    // moved without this moving with it would cut the fade off part-way.
    expect(themeCss).toContain(`--er-duration-fast: ${TOAST_EXIT_MS}ms;`);
    expect(indexCss).toContain('animation: motion-exit var(--motion-fast) var(--motion-ease) both;');
  });

  it('runs both sequences inside the no-preference query only', () => {
    const query = indexCss.match(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.motion-enter[\s\S]*?\n {2}\}/,
    );
    expect(query).toBeTruthy();
    expect(query[0]).toContain('animation: motion-enter var(--motion-base) var(--motion-ease) both;');
    // The exit is faster than the enter, and both take the same curve.
    expect(query[0]).toContain('var(--motion-fast)');
    expect(query[0]).not.toContain('ease-exit');
  });
});
