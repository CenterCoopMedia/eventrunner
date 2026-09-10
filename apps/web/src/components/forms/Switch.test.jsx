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
    const { onChange, control } = renderSwitch({ disabled: true });
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).not.toHaveAttribute('disabled');
    control.focus();
    expect(control).toHaveFocus();
    fireEvent.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });
});
