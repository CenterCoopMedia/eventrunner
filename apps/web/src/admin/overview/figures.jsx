// The overview's figure primitives (issues #179 to #181), shared by the page
// and its panels so every number on the overview is set the same way.

/** One word or the other, by count: "1 account", "2 accounts". */
export function plural(count, one, many) {
  return count === 1 ? one : many;
}

/**
 * A number from the getEventStats response, in the data face, bold and
 * tabular, printed exactly as it came. Missing reads as 0, and 0 is always
 * printed: a figure is never left out because it is zero.
 */
export function Figure({ value }) {
  return <span className="font-admin-data font-bold tabular-nums">{String(value ?? 0)}</span>;
}
