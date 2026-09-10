// The search field: its label, its clear control, and its spoken count.
import { useState } from 'react';
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

/**
 * The field with a real value behind it, so clearing it actually empties the
 * query and the clear control actually unmounts. A `vi.fn()` for `onChange`
 * holds the value still, which is exactly the case that hid this defect.
 */
function Driven({ initial = 'opening' }) {
  const [value, setValue] = useState(initial);
  return <SearchField label="Search sessions" value={value} onChange={setValue} />;
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

  it('puts focus on the field when the clear control clears itself away', () => {
    // The control renders only while there is something to clear, so
    // clearing removes the element that was holding focus. An element
    // removed while it holds focus drops focus to the body, which sends a
    // keyboard reader back to the top of the page. So the field takes it.
    render(<Driven />);
    const clear = screen.getByRole('button', { name: 'Clear search' });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search sessions' })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});
