// NoticeBar: a ruled band with a level, dismissed and remembered per browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NoticeBar, { isNoticeDismissed, rememberNoticeDismissed } from './NoticeBar.jsx';
import { renderInEveryStyle } from '../test/everyStyle.jsx';

describe('NoticeBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is a status region for information, with the word beside the message', () => {
    render(<NoticeBar id="doors">Doors open at nine.</NoticeBar>);
    const bar = screen.getByRole('status');
    expect(bar).toHaveClass('notice-bar');
    expect(bar).not.toHaveClass('notice-bar--urgent');
    expect(bar.textContent).toContain('Notice');
    expect(bar.textContent).toContain('Doors open at nine.');
  });

  it('is an alert on the strong rule when urgent', () => {
    render(<NoticeBar id="fire" level="urgent">The hall is closed this morning.</NoticeBar>);
    const bar = screen.getByRole('alert');
    expect(bar).toHaveClass('notice-bar--urgent');
    expect(bar.textContent).toContain('Urgent');
  });

  it('dismisses with a stated control and remembers it for this browser', () => {
    const onDismiss = vi.fn();
    const { container, unmount } = render(
      <NoticeBar id="doors" onDismiss={onDismiss}>Doors open at nine.</NoticeBar>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
    expect(container).toBeEmptyDOMElement();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(isNoticeDismissed('doors')).toBe(true);
    unmount();
    // The next visit does not draw it.
    const next = render(<NoticeBar id="doors">Doors open at nine.</NoticeBar>);
    expect(next.container).toBeEmptyDOMElement();
  });

  it('shows a new notice under a different id even after one was dismissed', () => {
    rememberNoticeDismissed('doors');
    render(<NoticeBar id="parking">Parking is closed.</NoticeBar>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a new notice that replaces a dismissed one in the same mounted slot', () => {
    // The slot under the header stays mounted while the notice in it
    // changes. A dismissal remembered as a flag would hide the next notice,
    // urgent or not; keyed to the id, it hides only the one dismissed.
    const { container, rerender } = render(<NoticeBar id="doors">Doors open at nine.</NoticeBar>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
    expect(container).toBeEmptyDOMElement();
    rerender(
      <NoticeBar id="closure" level="urgent">
        The hall is closed this morning.
      </NoticeBar>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The hall is closed this morning.');
    // And the dismissed one stays dismissed if it comes back.
    rerender(<NoticeBar id="doors">Doors open at nine.</NoticeBar>);
    expect(container).toBeEmptyDOMElement();
  });

  it('hands focus to the main landmark after a dismissal, never to the body', () => {
    render(
      <>
        <NoticeBar id="doors">Doors open at nine.</NoticeBar>
        <main id="main-content" tabIndex={-1}>
          The page.
        </main>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Dismiss this notice' });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('hands focus to the target the caller names', () => {
    render(
      <>
        <NoticeBar id="doors" focusTargetId="after-notice">Doors open at nine.</NoticeBar>
        <h1 id="after-notice" tabIndex={-1}>
          The title
        </h1>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this notice' }));
    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('shows the bar when storage refuses, which is the safe failure', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<NoticeBar id="doors">Doors open at nine.</NoticeBar>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    getItem.mockRestore();
  });

  it('renders nothing for an empty message', () => {
    const { container } = render(<NoticeBar id="blank">{''}</NoticeBar>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<NoticeBar id="every">Doors open at nine.</NoticeBar>, (container, pair) => {
      expect(container.querySelector('.notice-bar'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
