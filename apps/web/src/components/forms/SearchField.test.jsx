// The search field: its label, its clear control, and its spoken count.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SearchField from './SearchField.jsx';

function renderField(props = {}) {
  const onChange = vi.fn();
  render(
    <SearchField label="Search sessions" value="" onChange={onChange} {...props} />,
  );
  return onChange;
}

describe('SearchField', () => {
  it('is a labelled search input', () => {
    renderField();
    const input = screen.getByRole('searchbox', { name: 'Search sessions' });
    expect(input).toHaveAttribute('type', 'search');
  });

  it('reports what the reader types', () => {
    const onChange = renderField();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'opening' } });
    expect(onChange).toHaveBeenCalledWith('opening');
  });

  it('speaks the count the caller states', () => {
    renderField({ value: 'opening', status: '12 sessions match “opening”.' });
    expect(screen.getByRole('status')).toHaveTextContent('12 sessions match “opening”.');
  });

  it('keeps the count line in the document before the first count arrives', () => {
    // A live region added at the moment of the update is often missed. The
    // line has to be there first for the update to be announced.
    renderField();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('offers a clear control only when there is something to clear', () => {
    renderField();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears from the keyboard', () => {
    const onChange = renderField({ value: 'opening' });
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    expect(clear).toHaveFocus();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
