import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TicketingConfirmation from './TicketingConfirmation.jsx';

function confirmation(props = {}) {
  return <TicketingConfirmation title="Cancel the selected admission tickets?" confirmLabel="Cancel admission" onConfirm={() => {}} onClose={() => {}} {...props}>
    {props.children ?? <label>Reason for this action<textarea /></label>}
  </TicketingConfirmation>;
}

afterEach(() => vi.restoreAllMocks());

describe('TicketingConfirmation keyboard boundaries', () => {
  it('wraps forward from Go back to the first available field, skipping hidden and disabled controls', () => {
    render(confirmation({ children: <>
      <input type="hidden" value="order-reference" readOnly />
      <div hidden><button type="button">Hidden action</button></div>
      <fieldset disabled><input aria-label="Disabled field" /></fieldset>
      <div style={{ display: 'none' }}><input aria-label="Concealed field" /></div>
      <label>Reason for this action<textarea /></label>
    </> }));
    const last = screen.getByRole('button', { name: 'Go back' });
    last.focus();

    // jsdom does not perform browser Tab navigation. These assertions verify
    // the boundary correction itself; the hosted E2E also checks every Tab.
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Reason for this action' })).toHaveFocus();
  });

  it('wraps backward from the first field and the initially focused heading', () => {
    render(confirmation());
    const first = screen.getByRole('textbox', { name: 'Reason for this action' });
    const heading = screen.getByRole('heading', { name: 'Cancel the selected admission tickets?' });
    const last = screen.getByRole('button', { name: 'Go back' });
    expect(heading).toHaveFocus();

    expect(fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();
  });

  it('uses the current dialog controls after a rerender, including while an action is busy', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const view = render(confirmation({ onConfirm, onClose }));
    view.rerender(confirmation({ onConfirm, onClose, busy: true, children: <p>Saving the reviewed change.</p> }));
    const last = screen.getByRole('button', { name: 'Go back' });
    const first = screen.getByRole('button', { name: 'Saving…' });
    last.focus();

    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(first).toHaveFocus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();
    fireEvent.click(first);
    fireEvent.click(last);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('retains native modal opening, cancel handling, ordinary field keys, and opener focus restoration', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const onClose = vi.fn();
    const view = render(confirmation({ onClose }));
    const modal = screen.getByRole('dialog', { name: 'Cancel the selected admission tickets?' });
    expect(showModal).toHaveBeenCalledOnce();
    expect(modal).toHaveAttribute('open');
    const field = screen.getByRole('textbox', { name: 'Reason for this action' });
    field.focus();
    expect(fireEvent.keyDown(field, { key: 'ArrowLeft' })).toBe(true);
    expect(field).toHaveFocus();
    fireEvent(modal, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
