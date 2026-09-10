// The switch: its keyboard path and what it announces.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Switch from './Switch.jsx';

function renderSwitch(props = {}) {
  const onChange = vi.fn();
  render(
    <Switch label="Send read receipts" checked={false} onChange={onChange} {...props} />,
  );
  return { onChange, control: screen.getByRole('switch') };
}

describe('Switch', () => {
  it('is a switch, named by the label, and states its own value', () => {
    const { control } = renderSwitch();
    expect(control).toHaveAccessibleName('Send read receipts');
    expect(control).toHaveAttribute('aria-checked', 'false');
  });

  it('says the state in a word as well as in the attribute', () => {
    // Colour alone is never a state (design brief §2.4), and a shape a
    // reader has to interpret is not much better.
    const { control } = renderSwitch({ checked: true });
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveTextContent('On');
  });

  it('throws from the keyboard, on the key a button answers', () => {
    const { onChange, control } = renderSwitch();
    control.focus();
    expect(control).toHaveFocus();
    // A <button> turns Enter and Space into a click, so the keyboard path
    // is the click path. Asserting the click after focus is what proves the
    // control is reachable and operable without a pointer.
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('carries a hint to the control that the hint is about', () => {
    renderSwitch({ hint: 'Speakers see when you opened their message.' });
    expect(screen.getByRole('switch')).toHaveAccessibleDescription(
      'Speakers see when you opened their message.',
    );
  });

  it('states that it is unavailable and keeps its place in the tab order', () => {
    // `aria-disabled` rather than `disabled`, because a switch that cannot
    // be thrown usually has a reason, and a removed control announces
    // nothing. A reader can still land on it and hear the label and the
    // hint (interface guidelines, Accessibility).
    const { control } = renderSwitch({ disabled: true });
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).not.toHaveAttribute('disabled');
    control.focus();
    expect(control).toHaveFocus();
  });

  it('acts on nothing at all while it states that it is unavailable', () => {
    // A control that stays focusable has to refuse every way of working it,
    // not only the pointer: the handler is the gate, so Enter and Space —
    // which a button turns into a click — are refused with the click.
    const { onChange, control } = renderSwitch({ disabled: true });
    fireEvent.click(control);
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyUp(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: ' ' });
    fireEvent.keyUp(control, { key: ' ' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
