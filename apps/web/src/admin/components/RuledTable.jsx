// The admin's ruled table: rows and columns an operator compares (design
// vocabulary §3.1 and §3.4, drawn in the desk's own tokens).
//
// The props are the shape of the public editorial RuledTable (caption,
// hideCaption, columns, rows, sort), so a reader of one knows the other. It
// does not import it: the public table reads the client's tokens and the
// public scroll region, whose focus ring is the client accent, and the
// admin reads the admin-* tokens only.
//
// A REAL <table>: a caption, column heads scoped to their columns, hairline
// row rules, and figures end-aligned in the data face with tabular digits.
// The head is the galley head the ticketing tables draw, sticky at the top of
// the table's own box, so it stays in view while the rows scroll under it.
//
// THE BOX IS A FOCUSABLE REGION named by the caption, so a keyboard can
// scroll it both ways, and it scrolls sideways at a narrow width instead of
// the page. The admin ring (`.admin-room :focus-visible`) draws its focus.
//
// SORT. A column named in `sort` carries aria-sort, so a screen reader
// hears how the rows are ordered. This table draws no sort control: the
// caller hands it the rows in order and says which order that is.
const HEAD_CLASS =
  'sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs ' +
  'text-admin-xs font-semibold text-admin-ink-secondary';

/**
 * @param {{
 *   caption: string,
 *   hideCaption?: boolean,
 *   columns: Array<{ id: string, label: string, numeric?: boolean }>,
 *   rows: Array<{ id: string, cells: Record<string, import('react').ReactNode> }>,
 *   sort?: { column: string, direction: 'ascending' | 'descending' } | null,
 *   className?: string,
 *   tableClassName?: string,
 * }} props `className` sizes the scrolling box (a max height, say);
 *   `tableClassName` sets the width below which the box scrolls sideways.
 */
export default function RuledTable({
  caption,
  hideCaption = false,
  columns,
  rows,
  sort = null,
  className = '',
  tableClassName = 'min-w-[24rem]',
}) {
  const heads = Array.isArray(columns) ? columns : [];
  const body = Array.isArray(rows) ? rows : [];
  if (heads.length === 0) return null;

  return (
    // A scrolling region has to be reachable by keyboard to be scrolled by
    // one, so it takes a tab stop and the caption as its name.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={`overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline ${className}`}
    >
      <table className={`w-full border-collapse text-admin-sm ${tableClassName}`}>
        <caption
          className={
            hideCaption ? 'sr-only' : 'px-sm py-xs text-start text-admin-sm text-admin-ink-secondary'
          }
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {heads.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={sort?.column === column.id ? sort.direction : undefined}
                className={`${HEAD_CLASS} ${column.numeric ? 'text-end' : 'text-start'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row) => (
            <tr key={row.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
              {heads.map((column) => (
                <td
                  key={column.id}
                  className={
                    column.numeric
                      ? 'px-sm py-xs text-end font-admin-data tabular-nums text-admin-ink'
                      : 'px-sm py-xs text-admin-ink'
                  }
                >
                  {row.cells?.[column.id] ?? null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
