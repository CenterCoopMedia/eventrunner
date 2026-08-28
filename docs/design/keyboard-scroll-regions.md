# Keyboard-reachable horizontal scroll regions

A horizontally scrolling container becomes a keyboard stop only when its content is wider than its visible box. The same rule applies to the event site and the generated documentation.

## Behavior

- Keep native browser scrolling. Do not replace it with custom arrow-key logic.
- Measure `scrollWidth > clientWidth` after layout and when the container or its content changes.
- When content overflows, set `tabindex="0"`, `role="region"`, and a concise accessible name.
- When content no longer overflows, remove the tab stop and region semantics.
- Preserve the current scroll position when overflow state changes.
- Show the standard focus-visible ring around the whole scroll viewport. Do not rely on color alone.
- Do not hide the scrollbar when it is the only visible sign that more content exists.

## Accessible names

Use the nearest stable context when it exists, such as a schedule day heading, table caption, or code-example heading. Use a short fallback only when the source has no usable label. Do not expose file paths or implementation terms in the label.

## Tests

Test both states by controlling `clientWidth` and `scrollWidth`:

- A region with no overflow is not in the tab order.
- A region with overflow has a name, region semantics, and a visible focus treatment.
- A resize or content update adds and removes the tab stop correctly.
- The schedule, wide documentation tables, and wide code examples use the same behavior.
