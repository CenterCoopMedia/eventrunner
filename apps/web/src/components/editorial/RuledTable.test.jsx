// RuledTable: a real table with a sortable head that states its order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RuledTable from './RuledTable.jsx';
import { renderInEveryStyle } from '../../test/everyStyle.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));

const COLUMNS = [
  { id: 'session', label: 'Session', sortable: true },
  { id: 'room', label: 'Room' },
  { id: 'saved', label: 'Saved', numeric: true, sortable: true },
];

const ROWS = [
  { id: 'a', cells: { session: 'Opening panel', room: 'Main hall', saved: 12 } },
  { id: 'b', cells: { session: 'Budget workshop', room: 'Room A', saved: 7 } },
];

describe('RuledTable', () => {
  it('is a real table with a caption, column heads and one row per record', () => {
    render(<RuledTable caption="Sessions by saves" columns={COLUMNS} rows={ROWS} />);
    const table = screen.getByRole('table', { name: 'Sessions by saves' });
    expect(table).toHaveClass('ruled-table');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'Main hall' })).toBeInTheDocument();
  });

  it('sets a numeric column in tabular figures, right-aligned by the data attribute', () => {
    render(<RuledTable caption="Sessions by saves" columns={COLUMNS} rows={ROWS} />);
    const cell = screen.getByRole('cell', { name: '12' });
    expect(cell).toHaveAttribute('data-numeric');
    expect(cell).toHaveClass('font-mono');
    expect(screen.getByRole('cell', { name: 'Main hall' })).not.toHaveAttribute('data-numeric');
  });

  it('holds a button in a sortable head, and the th carries aria-sort', () => {
    const onSort = vi.fn();
    render(
      <RuledTable
        caption="Sessions by saves"
        columns={COLUMNS}
        rows={ROWS}
        sort={{ column: 'saved', direction: 'descending' }}
        onSort={onSort}
      />,
    );
    const saved = screen.getByRole('columnheader', { name: /Saved/u });
    expect(saved).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Session' })).toHaveAttribute('aria-sort', 'none');
    // A head that cannot sort carries no aria-sort at all.
    expect(screen.getByRole('columnheader', { name: 'Room' })).not.toHaveAttribute('aria-sort');
    const button = screen.getByRole('button', { name: /Saved.*sorted descending/u });
    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledWith('saved');
  });

  it('draws no sort control when the caller cannot sort', () => {
    render(<RuledTable caption="Sessions" columns={COLUMNS} rows={ROWS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('can hide its caption from sight and keep it for a screen reader', () => {
    render(<RuledTable caption="Sessions" hideCaption columns={COLUMNS} rows={ROWS} />);
    expect(screen.getByRole('table', { name: 'Sessions' }).querySelector('caption')).toHaveClass('sr-only');
  });

  it('sits inside a horizontal scroll region named by the caption', () => {
    const { container } = render(<RuledTable caption="Sessions" columns={COLUMNS} rows={ROWS} />);
    const region = container.querySelector('.horizontal-scroll-region');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('data-scroll-label', 'Sessions');
  });

  it('gives the region its own overflow, so a wide table scrolls inside it and not the page', () => {
    // jsdom measures no layout, so the class is the proof: the region is
    // the scroll container whether or not the caller passes one, and the
    // caller's own classes join it rather than replacing it.
    const { container, rerender } = render(<RuledTable caption="Sessions" columns={COLUMNS} rows={ROWS} />);
    expect(container.querySelector('.horizontal-scroll-region')).toHaveClass('overflow-x-auto');
    rerender(<RuledTable caption="Sessions" columns={COLUMNS} rows={ROWS} className="mt-sm" />);
    const region = container.querySelector('.horizontal-scroll-region');
    expect(region).toHaveClass('overflow-x-auto');
    expect(region).toHaveClass('mt-sm');
  });

  it('claims no sticky head: the stylesheet pins nothing inside the scroll region', () => {
    const css = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
    const rule = css.match(/\.ruled-table thead th \{[^}]*\}/u)?.[0] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toContain('position: sticky');
  });

  it('renders in every style and both modes', () => {
    renderInEveryStyle(<RuledTable caption="Sessions" columns={COLUMNS} rows={ROWS} />, (container, pair) => {
      expect(container.querySelectorAll('tbody tr'), `${pair.style} ${pair.mode}`).toHaveLength(2);
    });
  });
});
