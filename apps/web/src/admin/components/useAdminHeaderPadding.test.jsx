import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import useAdminHeaderPadding from './useAdminHeaderPadding.js';

function Editor({ dialog, position }) {
  const headerRef = useAdminHeaderPadding();
  const field = <textarea aria-label="Notes" />;
  return <form>
    <header ref={headerRef} style={{ position }}>Editor</header>
    {dialog ? <dialog open>{field}</dialog> : field}
  </form>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('focus below the admin title band', () => {
  it.each([
    { name: 'reveals an obscured control that fits below the band', height: 100, dialog: false, position: 'sticky', scrolls: true },
    { name: 'preserves the position within a tall editor', height: 1200, dialog: false, position: 'sticky', scrolls: false },
    { name: 'leaves modal scrolling to the dialog', height: 100, dialog: true, position: 'sticky', scrolls: false },
    { name: 'leaves scrolling headers alone', height: 100, dialog: false, position: 'static', scrolls: false },
    { name: 'keeps a pointer press in place through release', height: 100, dialog: false, position: 'sticky', pointer: 'during', scrolls: false },
    { name: 'reveals validation focus after a pointer release', height: 100, dialog: false, position: 'sticky', pointer: 'after', scrolls: true },
  ])('$name', ({ height, dialog, position, pointer, scrolls }) => {
    vi.stubGlobal('innerHeight', 900);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.tagName === 'HEADER'
        ? { height: 80, bottom: 80 }
        : { height, top: -40, bottom: height - 40 };
    });
    let frame;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    render(<Editor dialog={dialog} position={position} />);
    const field = screen.getByRole('textbox', { name: 'Notes' });
    field.scrollIntoView = vi.fn();
    act(() => {
      if (pointer) fireEvent.pointerDown(field);
      if (pointer === 'after') fireEvent.pointerUp(field);
      field.focus();
      if (pointer === 'during') fireEvent.pointerUp(field);
      frame?.();
    });
    expect(field.scrollIntoView).toHaveBeenCalledTimes(scrolls ? 1 : 0);
  });
});
