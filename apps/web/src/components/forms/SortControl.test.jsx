// The sort control: a labelled select, and nothing clever.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SortControl from './SortControl.jsx';

const OPTIONS = [
  { value: 'time', label: 'Start time' },
  { value: 'title', label: 'Title' },
];

describe('SortControl', () => {
  it('is a labelled select carrying every order', () => {
    render(
      <SortControl label="Sort sessions" options={OPTIONS} value="time" onChange={() => {}} />,
    );
    const select = screen.getByRole('combobox', { name: 'Sort sessions' });
    expect(select.tagName).toBe('SELECT');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Start time',
      'Title',
    ]);
  });

  it('reports the order the reader picks', () => {
    const onChange = vi.fn();
    render(
      <SortControl label="Sort sessions" options={OPTIONS} value="time" onChange={onChange} />,
    );
    const select = screen.getByRole('combobox');
    select.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: 'title' } });
    expect(onChange).toHaveBeenCalledWith('title');
  });

  it('names what is being ordered, not only that something is', () => {
    render(<SortControl label="Sort sessions" options={OPTIONS} value="time" onChange={() => {}} />);
    expect(screen.getByText('Sort sessions')).toBeInTheDocument();
  });
});
