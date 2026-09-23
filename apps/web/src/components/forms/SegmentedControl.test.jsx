// The segmented control: the radio group's keyboard, and what it announces.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SegmentedControl from './SegmentedControl.jsx';

const OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'all', label: 'All' },
];

function renderControl(value = 'day') {
  const onChange = vi.fn();
  render(
    <SegmentedControl label="Range" options={OPTIONS} value={value} onChange={onChange} />,
  );
  return { onChange, group: screen.getByRole('radiogroup'), options: screen.getAllByRole('radio') };
}

describe('SegmentedControl', () => {
  it('is a radio group with a name and one checked option', () => {
    const { group, options } = renderControl();
    expect(group).toHaveAccessibleName('Range');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-checked', 'true');
    expect(options[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('holds one place in the tab order', () => {
    // The checked option is the tab stop; the rest are reached with arrows.
    const { options } = renderControl('week');
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves and chooses with the arrow keys', () => {
    const { onChange, group } = renderControl('day');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('closes the ring at both ends', () => {
    const { onChange, group } = renderControl('day');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('reaches the ends with Home and End', () => {
    const { onChange, group } = renderControl('week');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('day');
    fireEvent.keyDown(group, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('all');
  });

  it('moves focus with the selection', () => {
    const { group, options } = renderControl('day');
    options[0].focus();
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(options[1]).toHaveFocus();
  });

  it('chooses with the pointer as well', () => {
    const { onChange, options } = renderControl();
    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it('marks the chosen word with weight as well as ground', () => {
    // The filled ground is the second signal, never the only one.
    const { options } = renderControl('all');
    expect(options[2].className).toContain('aria-checked:font-bold');
  });

  // An unavailable option (expansion record §2.1): aria-disabled, focusable
  // so it can explain itself, and every activation path refused.
  it('marks an unavailable option and refuses to choose it by pointer or by key', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Range"
        options={[OPTIONS[0], { ...OPTIONS[1], disabled: true, hint: 'No sessions this week' }, OPTIONS[2]]}
        value="day"
        onChange={onChange}
      />,
    );
    const options = screen.getAllByRole('radio');
    expect(options[1]).toHaveAttribute('aria-disabled', 'true');
    expect(options[1]).not.toBeDisabled();
    expect(options[1]).toHaveAccessibleName('Week (No sessions this week)');
    fireEvent.click(options[1]);
    expect(onChange).not.toHaveBeenCalled();
    options[0].focus();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(options[1]).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    // From the unavailable option the next key moves on and chooses.
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
