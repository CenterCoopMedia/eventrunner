// Repeater: labelled rows, one remove control each, one add control, and a
// keyboard path through all of it.
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Repeater from './Repeater.jsx';
import { TextField } from './publicForm.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

function Harness({ start = [{ id: 'a', url: 'https://example.org' }], max }) {
  const [rows, setRows] = useState(start);
  return (
    <Repeater
      legend="Links"
      rows={rows}
      rowName="link"
      max={max}
      addLabel="Add a link"
      emptyLine="No links yet."
      onAdd={() => setRows((current) => [...current, { id: `r${current.length + 1}`, url: '' }])}
      onRemove={(id) => setRows((current) => current.filter((row) => row.id !== id))}
      renderRow={(row, index) => (
        <TextField
          label={`Link ${index + 1}`}
          value={row.url}
          onChange={(url) => setRows((current) => current.map((r) => (r.id === row.id ? { ...r, url } : r)))}
        />
      )}
    />
  );
}

describe('Repeater', () => {
  it('is a fieldset with a legend, one labelled field per row, and a named remove control', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Links' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove link 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a link' })).toBeInTheDocument();
  });

  it('adds a row and moves focus to its first field', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByLabelText('Link 2')).toHaveFocus();
  });

  it('removes a row and moves focus to the row before it', () => {
    render(<Harness start={[{ id: 'a', url: '' }, { id: 'b', url: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 2' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByLabelText('Link 1')).toHaveFocus();
  });

  it('moves focus to the add control when the last row goes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 1' }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No links yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a link' })).toHaveFocus();
  });

  it('states the count against a cap and keeps the add control at it, unavailable and explained', () => {
    render(<Harness start={[{ id: 'a', url: '' }, { id: 'b', url: '' }]} max={2} />);
    expect(screen.getByRole('group', { name: /Links.*2 of 2/u })).toBeInTheDocument();
    // The control is never removed (expansion record §2.1): it stays in the
    // tab order with aria-disabled, its name states the limit, and pressing
    // it adds nothing.
    const add = screen.getByRole('button', { name: 'Add a link (2 of 2, the limit)' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(add).not.toBeDisabled();
    fireEvent.click(add);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Remove one and the control is available again under its plain name.
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 2' }));
    const again = screen.getByRole('button', { name: 'Add a link' });
    expect(again).not.toHaveAttribute('aria-disabled');
    fireEvent.click(again);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('rules its rows through the contract class', () => {
    render(<Harness />);
    expect(screen.getByRole('listitem')).toHaveClass('repeater__row');
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<Harness />, (container, pair) => {
      expect(container.querySelector('.repeater .repeater__row'), `${pair.style} ${pair.mode}`).not.toBeNull();
    });
  });
});
