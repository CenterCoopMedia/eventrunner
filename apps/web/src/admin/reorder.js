// Order helpers for issue #448.
//
// A list shows a local order until Save draft. The stored order is the
// displayed index, so ties compact to one sequence. Cancel drops the local
// order. The server list replaces it only when its id sequence matches.

import { useEffect, useState } from 'react';

/** Finite stored order, or 0 when the record has none. */
export function storedOrder(row) {
  const order = Number(row?.current?.order);
  return Number.isFinite(order) ? order : 0;
}

/** Sort a copy by stored order, then id. */
export function byStoredOrder(rows) {
  return [...(rows ?? [])].sort(
    (a, b) => storedOrder(a) - storedOrder(b) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')),
  );
}

/**
 * Move one item. The same list comes back for a no-op, including a drop
 * on the item's own row.
 */
export function moveItem(list, from, to) {
  if (!Array.isArray(list)) return list;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Local ids win. Missing ids drop out. New server ids append. */
export function displayRows(serverRows, localIds) {
  const rows = serverRows ?? [];
  if (!localIds) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [];
  for (const id of localIds) {
    if (!byId.has(id)) continue;
    ordered.push(byId.get(id));
    byId.delete(id);
  }
  for (const row of rows) {
    if (byId.has(row.id)) ordered.push(row);
  }
  return ordered;
}

/** Rows whose stored order is not already their displayed index. */
export function ordersToWrite(rows) {
  const writes = [];
  (rows ?? []).forEach((row, index) => {
    if (Number(row?.current?.order) !== index) writes.push({ row, order: index });
  });
  return writes;
}

/** One past the highest stored order, or 0 when nothing has an order yet. */
export function nextStoredOrder(rows) {
  const orders = (rows ?? [])
    .map((row) => Number(row?.current?.order))
    .filter((order) => Number.isFinite(order));
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

/** Index carried by a drag token, or null when the token is a different list. */
export function dragIndex(token, prefix) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) return null;
  const rest = token.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

function sameIds(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

/**
 * @param {Array<{ id: string, current?: object }>} serverRows
 */
export function useDraftOrder(serverRows) {
  const [localIds, setLocalIds] = useState(null);
  const rows = displayRows(serverRows, localIds);

  useEffect(() => {
    if (!localIds) return;
    const serverIds = (serverRows ?? []).map((row) => row.id);
    if (sameIds(localIds, serverIds)) setLocalIds(null);
  }, [serverRows, localIds]);

  function move(from, to) {
    const next = moveItem(rows, from, to);
    if (next === rows) return false;
    const ids = next.map((row) => row.id);
    const serverIds = (serverRows ?? []).map((row) => row.id);
    setLocalIds(sameIds(ids, serverIds) ? null : ids);
    return true;
  }

  function cancel() {
    setLocalIds(null);
  }

  return { rows, dirty: localIds !== null, move, cancel };
}

/**
 * Save every changed order. One failure does not stop the rest.
 * @returns {Promise<string[]>} names that failed
 */
export async function saveOrderWrites(writes, writeOne, nameOf) {
  const failed = [];
  for (const change of writes) {
    try {
      await writeOne(change);
    } catch {
      failed.push(nameOf(change.row));
    }
  }
  return failed;
}

/** The notice after a reorder save. Publication stays a separate action. */
export function orderSaveMessage(failed) {
  if (failed.length === 0) {
    return { tone: 'ok', message: 'Draft order saved. It is not public until you publish.' };
  }
  return {
    tone: 'error',
    message: `Could not save the order for ${failed.join(', ')}. The list still shows your order. Save draft again to retry the rest.`,
  };
}
