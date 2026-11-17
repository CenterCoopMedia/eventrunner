// Synthetic Calendar v3 network boundary. Responses follow events.list,
// insert/get/update/patch/delete: IDs survive deletion as tombstones.
export const calendarEvent = {
  name: '[Fixture] Lakeshore Docs Camp', timezone: 'America/Chicago',
  days: [{ id: 'd1', label: 'Day one', date: '2026-10-15' }],
};
export const calendarSession = {
  id: 's1', dayId: 'd1', startTime: '09:05', endTime: '09:45',
  title: 'Morning kickoff', description: 'What the day covers', location: 'Main hall',
};
export const calendarUser = {
  uid: 'u1', auth: { app: { options: { projectId: 'demo-calendar' } } },
  providerData: [{ providerId: 'google.com', uid: 'g1' }],
};
export function calendarResponse(status, body = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}
export function calendarProvider(items = [], { pageSize = 2500, tombstoneStatus = 200 } = {}) {
  const events = new Map(items.map((item) => [item.id, structuredClone(item)]));
  const calls = [];
  const failures = new Map();
  const fetchImpl = async (url, init) => {
    const endpoint = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const method = init.method;
    const call = { url, method, body, signal: init.signal };
    calls.push(call);
    const key = `${method} ${endpoint.pathname}`;
    if (failures.has(key)) return calendarResponse(failures.get(key));
    if (endpoint.pathname.endsWith('/calendars') && method === 'POST') return calendarResponse(200, { id: 'c1' });
    const id = endpoint.pathname.split('/events/')[1];
    if (method === 'GET' && !id) {
      const filter = endpoint.searchParams.get('privateExtendedProperty');
      const [property, value] = filter?.split('=') ?? [];
      const matching = [...events.values()].filter((event) => event.status !== 'cancelled' &&
        (!filter || event.extendedProperties?.private?.[property] === value));
      const offset = Number(endpoint.searchParams.get('pageToken') ?? 0);
      return calendarResponse(200, {
        items: matching.slice(offset, offset + pageSize),
        ...(offset + pageSize < matching.length ? { nextPageToken: String(offset + pageSize) } : {}),
      });
    }
    if (method === 'POST') {
      if (!/^[0-9a-v]{5,1024}$/.test(body.id)) return calendarResponse(400);
      if (events.has(body.id)) return calendarResponse(409, { error: { errors: [{ reason: 'duplicate' }] } });
      events.set(body.id, { ...body, status: 'confirmed' });
      return calendarResponse(200, events.get(body.id));
    }
    const existing = events.get(id);
    if (!existing) return calendarResponse(404);
    if (method === 'GET') return calendarResponse(existing.status === 'cancelled' ? tombstoneStatus : 200, existing);
    if (existing.status === 'cancelled') return calendarResponse(410, { error: { errors: [{ reason: 'deleted' }] } });
    if (method === 'DELETE') {
      events.set(id, { id, status: 'cancelled' });
      return calendarResponse(204);
    }
    events.set(id, method === 'PATCH' ? { ...existing, ...body } : { ...body, id, status: 'confirmed' });
    return calendarResponse(200, events.get(id));
  };
  return { events, calls, failures, fetchImpl, live: () => [...events.values()].filter((event) => event.status !== 'cancelled') };
}
