// RuledTable — rows and columns a reader compares (expansion record §3.1).
//
// A REAL <table>, with a caption, column heads, row rules, tabular figures,
// a head that stays in view while the body scrolls under it, and a
// horizontal scroll region at narrow widths so the page never scrolls
// sideways. A grid of divs would lose the reading a screen reader gives a
// table — the column head announced with every cell — and that reading is
// what a table is for.
//
// A SORTABLE HEAD HOLDS A <button> THAT SORTS, AND THE <th> CARRIES
// aria-sort. The button is the whole word, so the target is the word a
// reader would press anyway; the direction is stated in hidden text as
// well as drawn, so it is never a glyph alone. The caller owns the order:
// this component draws the rows it is handed and reports which head was
// pressed, because sorting a list is the page's decision (what the URL
// remembers, what the count line says), not the table's.
//
// The rules read the `table` contract, which is what the Table rules option
// in each style remaps: hairline rows, a ruled head, or the full grid.
import HorizontalScrollRegion from '../HorizontalScrollRegion.jsx';

/** The direction words, as aria-sort states and as the hidden sentence. */
const SORT_WORD = Object.freeze({
  ascending: 'sorted ascending',
  descending: 'sorted descending',
});

/** The drawn mark for a sorted column. Hidden from assistive technology. */
const SORT_MARK = Object.freeze({ ascending: '↑', descending: '↓' });

/**
 * @param {{
 *   caption: string,                       // what the table is; drawn or hidden
 *   hideCaption?: boolean,
 *   columns: Array<{
 *     id: string,
 *     label: string,
 *     numeric?: boolean,                   // right-aligned tabular figures
 *     sortable?: boolean,
 *   }>,
 *   rows: Array<{ id: string, cells: Record<string, import('react').ReactNode> }>,
 *   sort?: { column: string, direction: 'ascending' | 'descending' } | null,
 *   onSort?: (columnId: string) => void,
 *   className?: string,
 * }} props
 */
export default function RuledTable({
  caption,
  hideCaption = false,
  columns,
  rows,
  sort = null,
  onSort,
  className = '',
}) {
  const heads = Array.isArray(columns) ? columns : [];
  const body = Array.isArray(rows) ? rows : [];
  if (heads.length === 0) return null;

  return (
    <HorizontalScrollRegion label={caption} className={className}>
      <table className="ruled-table">
        <caption
          className={
            hideCaption ? 'sr-only' : 'pb-sm font-data text-caption text-text-secondary'
          }
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {heads.map((column) => {
              const sorted = sort?.column === column.id ? sort.direction : null;
              const sortable = Boolean(column.sortable && onSort);
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sortable ? sorted ?? 'none' : undefined}
                  {...(column.numeric ? { 'data-numeric': true } : {})}
                  className="text-caption font-semibold text-text-primary"
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="ruled-table__sort touch-target hover:underline"
                      onClick={() => onSort(column.id)}
                    >
                      <span>{column.label}</span>
                      {sorted ? (
                        <>
                          <span aria-hidden="true">{SORT_MARK[sorted]}</span>
                          <span className="sr-only">, {SORT_WORD[sorted]}</span>
                        </>
                      ) : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {body.map((row) => (
            <tr key={row.id}>
              {heads.map((column) => (
                <td
                  key={column.id}
                  {...(column.numeric ? { 'data-numeric': true } : {})}
                  className={column.numeric ? 'font-mono text-body text-text-primary' : 'text-body text-text-primary'}
                >
                  {row.cells?.[column.id] ?? null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </HorizontalScrollRegion>
  );
}
