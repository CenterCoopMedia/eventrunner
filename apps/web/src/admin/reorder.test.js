import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bindReorderDrop } from './components/ReorderControls.jsx';
import {
  byStoredOrder,
  displayRows,
  dragIndex,
  moveItem,
  nextStoredOrder,
  orderSaveMessage,
  ordersToWrite,
  useDraftOrder,
} from './reorder.js';

describe('moveItem', () => {
  it('returns the same list for a same-position drop and for an index outside the list', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 0, 3)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
  });

  it('moves the first item to the end and the last item to the start', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('keeps every item through repeated moves', () => {
    const once = moveItem(['a', 'b', 'c'], 0, 2);
    expect(moveItem(once, 2, 1)).toEqual(['b', 'a', 'c']);
  });
});

describe('stored order', () => {
  const rows = [
    { id: 'b', current: { order: 0 } },
    { id: 'a', current: { order: 0 } },
    { id: 'c', current: { order: 2 } },
    { id: 'd', current: {} },
  ];

  it('breaks a tie by id and treats a missing order as 0', () => {
    expect(byStoredOrder(rows).map((row) => row.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('writes only the rows whose stored order is not already the index', () => {
    const sorted = byStoredOrder(rows);
    expect(ordersToWrite(sorted).map((change) => [change.row.id, change.order])).toEqual([
      ['b', 1],
      ['d', 2],
      ['c', 3],
    ]);
  });

  it('keeps a local id order, drops a gone id, and appends a new server id', () => {
    const shown = displayRows(
      [{ id: 'a' }, { id: 'c' }, { id: 'b' }],
      ['b', 'missing', 'a'],
    );
    expect(shown.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('gives the next order after the highest, and 0 only for an empty list', () => {
    expect(nextStoredOrder([])).toBe(0);
    expect(nextStoredOrder([{ current: {} }, { current: { order: 4 } }])).toBe(5);
    expect(nextStoredOrder([{ current: {} }, { current: {} }])).toBe(1);
  });
});

describe('dragIndex', () => {
  it('reads an index only for the list that started the drag', () => {
    expect(dragIndex('section:2', 'section:')).toBe(2);
    expect(dragIndex('block:1:2', 'block:1:')).toBe(2);
    expect(dragIndex('block:1:2', 'section:')).toBeNull();
    expect(dragIndex('section:2', 'section')).toBeNull();
    expect(dragIndex('page:', 'page:')).toBeNull();
  });
});

describe('bindReorderDrop', () => {
  it('moves on a same-list drop and ignores a token from another list', () => {
    const moves = [];
    const drop = bindReorderDrop('page:', 0, (from, to) => moves.push([from, to]));
    const event = (token) => ({
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { getData: () => token },
    });
    drop.onDrop(event('section:1'));
    drop.onDrop(event('page:1'));
    expect(moves).toEqual([[1, 0]]);
  });
});

describe('orderSaveMessage', () => {
  it('keeps publication out of a successful draft save and names a partial failure', () => {
    expect(orderSaveMessage([])).toEqual({
      tone: 'ok',
      message: 'Draft order saved. It is not public until you publish.',
    });
    expect(orderSaveMessage(['FAQ']).message).toContain('FAQ');
    expect(orderSaveMessage(['FAQ']).message).toContain('Save draft again');
  });
});

describe('useDraftOrder', () => {
  const server = [
    { id: 'a', current: { order: 0 } },
    { id: 'b', current: { order: 1 } },
  ];

  it('keeps the local order until each stored order matches its index, and cancel restores it', () => {
    const { result, rerender } = renderHook(({ rows }) => useDraftOrder(rows), {
      initialProps: { rows: server },
    });
    act(() => {
      expect(result.current.move(0, 0)).toBe(false);
      expect(result.current.move(1, 0)).toBe(true);
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.rows.map((row) => row.id)).toEqual(['b', 'a']);

    rerender({ rows: server });
    expect(result.current.dirty).toBe(true);

    rerender({
      rows: [
        { id: 'b', current: { order: 0 } },
        { id: 'a', current: { order: 1 } },
      ],
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.rows.map((row) => row.id)).toEqual(['b', 'a']);

    act(() => result.current.move(0, 1));
    expect(result.current.rows.map((row) => row.id)).toEqual(['a', 'b']);
    act(() => result.current.cancel());
    expect(result.current.dirty).toBe(false);
    expect(result.current.rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('stays dirty when a partial save matches the id sequence before every order is stored', () => {
    const start = [
      { id: 'b', current: { order: 0 } },
      { id: 'c', current: { order: 1 } },
      { id: 'a', current: { order: 2 } },
    ];
    const { result, rerender } = renderHook(({ rows }) => useDraftOrder(rows), {
      initialProps: { rows: start },
    });
    act(() => {
      expect(result.current.move(2, 0)).toBe(true);
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    rerender({
      rows: [
        { id: 'a', current: { order: 0 } },
        { id: 'b', current: { order: 0 } },
        { id: 'c', current: { order: 1 } },
      ],
    });
    expect(result.current.dirty).toBe(true);
    rerender({
      rows: [
        { id: 'a', current: { order: 0 } },
        { id: 'b', current: { order: 1 } },
        { id: 'c', current: { order: 2 } },
      ],
    });
    expect(result.current.dirty).toBe(false);
  });
});
