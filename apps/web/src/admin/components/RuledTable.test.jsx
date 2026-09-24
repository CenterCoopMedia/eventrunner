// The admin's ruled table (issues #181, #182): a real table in a focusable,
// named scroll region, figures end-aligned, and aria-sort on the column the
// rows are ordered by.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import RuledTable from './RuledTable.jsx';

const COLUMNS = [
  { id: 'name', label: 'Session' },
  { id: 'count', label: 'Saved', numeric: true },
];
const ROWS = [
  { id: 'b', cells: { name: 'Second', count: 9 } },
  { id: 'a', cells: { name: 'First', count: 4 } },
];

describe('RuledTable', () => {
  it('draws a captioned table inside a focusable region the caption names', () => {
    render(<RuledTable caption="Sessions by saves, most first." columns={COLUMNS} rows={ROWS} />);
    const region = screen.getByRole('region', { name: 'Sessions by saves, most first.' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toMatch(/overflow-auto/);
    const table = within(region).getByRole('table', { name: 'Sessions by saves, most first.' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.getAttribute('scope'))).toEqual(['col', 'col']);
    const cells = within(table).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['Second', '9', 'First', '4']);
    expect(cells[1].className).toMatch(/text-end/);
    expect(cells[1].className).toMatch(/font-admin-data/);
    expect(cells[0].className).not.toMatch(/text-end/);
  });

  it('marks the sorted column with aria-sort and draws no sort control', () => {
    render(
      <RuledTable
        caption="Sorted"
        hideCaption
        columns={COLUMNS}
        rows={ROWS}
        sort={{ column: 'count', direction: 'descending' }}
      />,
    );
    const [name, count] = screen.getAllByRole('columnheader');
    expect(count).toHaveAttribute('aria-sort', 'descending');
    expect(name).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('caption').className).toBe('sr-only');
  });

  it('draws nothing without columns', () => {
    const { container } = render(<RuledTable caption="Empty" columns={[]} rows={ROWS} />);
    expect(container).toBeEmptyDOMElement();
  });
});
