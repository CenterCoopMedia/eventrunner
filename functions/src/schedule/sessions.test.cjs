'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateSessionShape,
  checkSessionTrack,
  checkSessionPlace,
  checkSessionParent,
  checkSessionChildren,
  checkSchedulePublishSet,
  validateSessionStructure,
  resolveSessionTrack,
} = require('./sessions.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

function session(overrides = {}) {
  return { dayId: 'day-2', title: 'Workshop', startTime: '13:30', ...overrides };
}

/** An event that defines the tracks named, plus whatever else is seeded. */
function dbWithTracks(letters, seed = {}) {
  return makeFakeDb({
    'config/event': { tracks: letters.map((letter) => ({ letter, name: `Line ${letter}` })) },
    ...seed,
  });
}

// --- track (design brief §4.6) ----------------------------------------------

test('a session may carry no track at all', () => {
  assert.equal(validateSessionShape(session(), 'session-1').ok, true);
  assert.equal(validateSessionShape(session({ track: null }), 'session-1').ok, true);
  assert.equal(validateSessionShape(session({ track: '' }), 'session-1').ok, true);
});

test('a track is one capital letter, A to Z', () => {
  for (const letter of ['A', 'B', 'Z']) {
    assert.equal(validateSessionShape(session({ track: letter }), 'session-1').ok, true, letter);
  }
});

test('anything else is rejected, naming the field and the value', () => {
  for (const bad of ['AB', 'a', '1', ' A', 3, {}]) {
    const { ok, errors } = validateSessionShape(session({ track: bad }), 'session-1');
    assert.equal(ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.match(errors[0], /^track: /);
  }
});

// --- track membership (design brief §4.6) -----------------------------------

test('a track letter must name one of the event’s tracks', async () => {
  const db = dbWithTracks(['A', 'B']);
  assert.deepEqual(
    await checkSessionTrack({ db, fields: session({ track: 'B' }) }),
    { ok: true, errors: [] },
  );
});

test('a letter no track defines is rejected, naming the letters that are', async () => {
  const db = dbWithTracks(['A', 'B']);
  const verdict = await checkSessionTrack({ db, fields: session({ track: 'C' }) });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /^track: "C" is not one of this event's tracks \(A, B\)/);
});

test('an event with no tracks configured accepts no track letter at all', async () => {
  for (const db of [makeFakeDb(), makeFakeDb({ 'config/event': {} }), dbWithTracks([])]) {
    const verdict = await checkSessionTrack({ db, fields: session({ track: 'A' }) });
    assert.equal(verdict.ok, false);
    assert.match(verdict.errors[0], /^track: this event defines no tracks/);
  }
});

test('a session with no track never reads the config', async () => {
  const db = makeFakeDb();
  for (const track of [undefined, null, '']) {
    assert.deepEqual(
      await checkSessionTrack({ db, fields: session({ track }) }),
      { ok: true, errors: [] },
    );
  }
});

test('the track is read fresh from config/event, not from a cached config', async () => {
  // The staleness trap this check exists to avoid: an operator adds track C
  // in event settings and puts a session on it in the next breath. A
  // five-minute container cache would refuse the session; a document read
  // sees the track that is actually there.
  const db = dbWithTracks(['A']);
  assert.equal((await checkSessionTrack({ db, fields: session({ track: 'C' }) })).ok, false);
  await db.collection('config').doc('event').set({
    tracks: [{ letter: 'A', name: 'Line A' }, { letter: 'C', name: 'Line C' }],
  });
  assert.equal((await checkSessionTrack({ db, fields: session({ track: 'C' }) })).ok, true);
});

// --- placeId: the reference the movement model resolves through -------------

/** An event whose venue defines the places named. */
function dbWithPlaces(ids, seed = {}) {
  return makeFakeDb({
    'config/event': { venue: { places: ids.map((id) => ({ id, name: id })) } },
    ...seed,
  });
}

test('a session may be in no recorded place at all', () => {
  // The ordinary state for most events: a venue that has recorded no places
  // has every session in none of them.
  for (const placeId of [undefined, null, '']) {
    assert.equal(validateSessionShape(session({ placeId }), 'session-1').ok, true);
  }
});

test('a placeId is a place id, and anything else is rejected by name', () => {
  assert.equal(validateSessionShape(session({ placeId: 'main-hall' }), 'session-1').ok, true);
  for (const bad of ['Main Hall', 'main_hall', 'main--hall', '-main', 42, {}]) {
    const { ok, errors } = validateSessionShape(session({ placeId: bad }), 'session-1');
    assert.equal(ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.match(errors[0], /^placeId: /);
  }
});

test('a placeId must name one of the venue’s places', async () => {
  const db = dbWithPlaces(['main-hall', 'room-a']);
  assert.deepEqual(
    await checkSessionPlace({ db, fields: session({ placeId: 'room-a' }) }),
    { ok: true, errors: [] },
  );
});

test('a place the venue does not define is rejected, naming the ones it does', async () => {
  // Silence is what an unrecorded route looks like, so an id nothing
  // defines would be indistinguishable from "nobody walked that route".
  // The save is the only place the difference can still be said out loud.
  const db = dbWithPlaces(['main-hall', 'room-a']);
  const verdict = await checkSessionPlace({ db, fields: session({ placeId: 'room-z' }) });
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.errors[0],
    /^placeId: "room-z" is not one of this venue's places \(main-hall, room-a\)/,
  );
});

test('a venue with no places accepts no placeId at all', async () => {
  for (const db of [makeFakeDb(), makeFakeDb({ 'config/event': {} }), dbWithPlaces([])]) {
    const verdict = await checkSessionPlace({ db, fields: session({ placeId: 'main-hall' }) });
    assert.equal(verdict.ok, false);
    assert.match(verdict.errors[0], /^placeId: this event's venue defines no places/);
  }
});

test('a session with no place never reads the config', async () => {
  const db = makeFakeDb();
  for (const placeId of [undefined, null, '']) {
    assert.deepEqual(
      await checkSessionPlace({ db, fields: session({ placeId }) }),
      { ok: true, errors: [] },
    );
  }
});

test('the place is read fresh from config/event, not from a cached config', async () => {
  const db = dbWithPlaces(['main-hall']);
  assert.equal((await checkSessionPlace({ db, fields: session({ placeId: 'room-a' }) })).ok, false);
  await db.collection('config').doc('event').set({
    venue: { places: [{ id: 'main-hall', name: 'Main hall' }, { id: 'room-a', name: 'Room A' }] },
  });
  assert.equal((await checkSessionPlace({ db, fields: session({ placeId: 'room-a' }) })).ok, true);
});

// --- parentId ---------------------------------------------------------------

test('a parentId must be a document id, and never the session itself', () => {
  assert.equal(validateSessionShape(session({ parentId: 'session-2' }), 'session-1').ok, true);
  assert.match(
    validateSessionShape(session({ parentId: 'a/b' }), 'session-1').errors[0],
    /^parentId: must be a session document id/,
  );
  for (const bad of ['', '.', '..', 'a/b', 'x'.repeat(301), 42, null]) {
    const fields = { ...session(), parentId: bad };
    if (bad === '' || bad === null) {
      // Clearing the field is how an editor says "no parent".
      assert.equal(validateSessionShape(fields, 'session-1').ok, true, JSON.stringify(bad));
      continue;
    }
    assert.equal(validateSessionShape(fields, 'session-1').ok, false, JSON.stringify(bad));
  }
  const self = validateSessionShape(session({ parentId: 'session-1' }), 'session-1');
  assert.equal(self.ok, false);
  assert.match(self.errors[0], /cannot be its own parent \("session-1"\)/);
});

test('any session that can be created can be named as a parent', async () => {
  // The endpoints key a session by isValidDocId, so ids with dots, spaces
  // and capitals are creatable — and therefore have to be nameable. A
  // narrower rule here would strand those sessions with no way to point at
  // them.
  for (const id of ['keynote.day1', 'Session 3', 'a'.repeat(300)]) {
    const shape = validateSessionShape(session({ parentId: id }), 'session-child');
    assert.deepEqual(shape, { ok: true, errors: [] }, id);
    const db = makeFakeDb({ [`cmsSchedule/${id}`]: { dayId: 'day-2' } });
    const verdict = await checkSessionParent({
      db,
      docId: 'session-child',
      fields: session({ parentId: id }),
    });
    assert.deepEqual(verdict, { ok: true, errors: [] }, id);
  }
});

test('an orphan parent is rejected, naming the id', async () => {
  const db = makeFakeDb();
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-ghost' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /no session exists with id "session-ghost"/);
});

test('a live parent is enough, and so is a draft-only one', async () => {
  const live = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2' } });
  assert.equal(
    (await checkSessionParent({ db: live, docId: 'c', fields: session({ parentId: 'session-parent' }) })).ok,
    true,
  );
  const draftOnly = makeFakeDb({ 'cmsSchedule_drafts/session-parent': { dayId: 'day-2' } });
  assert.equal(
    (await checkSessionParent({ db: draftOnly, docId: 'c', fields: session({ parentId: 'session-parent' }) })).ok,
    true,
  );
});

test('the draft revision is what a parent is judged by', async () => {
  // The live doc still says day-2; the unpublished draft has moved it.
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2' },
    'cmsSchedule_drafts/session-parent': { dayId: 'day-3' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', dayId: 'day-2' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /runs on day "day-3"/);
});

test('a child runs on its parent’s day, and a mismatch names both days', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-1' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', dayId: 'day-3' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /"day-1"/);
  assert.match(verdict.errors[0], /"day-3"/);
});

test('children are one level deep: a child cannot be a parent', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-top': { dayId: 'day-2' },
    'cmsSchedule/session-middle': { dayId: 'day-2', parentId: 'session-top' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-bottom',
    fields: session({ parentId: 'session-middle' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /is itself a child of "session-top"/);
});

test('a session that already has children cannot become a child — no cycles', async () => {
  // The second half of every cycle: A → B is already stored, so B → A is
  // the write that would close the loop, and it is refused.
  const db = makeFakeDb({
    'cmsSchedule/session-a': { dayId: 'day-2', parentId: 'session-b' },
    'cmsSchedule/session-b': { dayId: 'day-2' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-b',
    fields: session({ parentId: 'session-a' }),
  });
  assert.equal(verdict.ok, false);
  // Both halves are named: the parent is a child, and this session is a parent.
  assert.ok(verdict.errors.some((e) => e.includes('already has child sessions (session-a)')));
});

test('a draft child counts too — an unpublished child still makes this a parent', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-b': { dayId: 'day-2' },
    'cmsSchedule/session-c': { dayId: 'day-2' },
    'cmsSchedule_drafts/session-a': { dayId: 'day-2', parentId: 'session-b' },
  });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-b',
    fields: session({ parentId: 'session-c' }),
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes('already has child sessions')));
});

// --- a child runs on its parent's line (design brief §4.6) ------------------

test('a child may state no track at all: it inherits its parent’s', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2', track: 'B' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent' }),
  });
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

test('a child may repeat its parent’s track', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2', track: 'B' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', track: 'B' }),
  });
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

test('a child on another line is rejected, naming both tracks', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2', track: 'B' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', track: 'A' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /^track: "A" is not the track of its parent "session-parent"/);
  assert.match(verdict.errors[0], /which runs on "B"/);
});

test('a track on a child of a parent that runs on none is rejected too', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2' } });
  const verdict = await checkSessionParent({
    db,
    docId: 'session-child',
    fields: session({ parentId: 'session-parent', track: 'A' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /which runs on no track/);
});

test('resolveSessionTrack: own line first, the parent’s otherwise', () => {
  const parent = { id: 'p', dayId: 'day-2', track: 'B' };
  const byId = { p: parent, plain: { id: 'plain', dayId: 'day-2' } };
  assert.equal(resolveSessionTrack({ track: 'A' }, byId), 'A');
  assert.equal(resolveSessionTrack({ parentId: 'p' }, byId), 'B');
  assert.equal(resolveSessionTrack({ track: 'B', parentId: 'p' }, byId), 'B');
  // A session on no line, a parent on no line, and a parent the renderer
  // does not hold all read the same way: no line.
  assert.equal(resolveSessionTrack({ dayId: 'day-2' }, byId), null);
  assert.equal(resolveSessionTrack({ parentId: 'plain' }, byId), null);
  assert.equal(resolveSessionTrack({ parentId: 'ghost' }, byId), null);
  assert.equal(resolveSessionTrack(null, byId), null);
  assert.equal(resolveSessionTrack({ parentId: 'p' }, null), null);
});

test('resolveSessionTrack reads a Map as well as a plain object', () => {
  const byId = new Map([['p', { track: 'C' }]]);
  assert.equal(resolveSessionTrack({ parentId: 'p' }, byId), 'C');
});

test('a session with no parent never reads anything', async () => {
  const db = makeFakeDb();
  const verdict = await checkSessionParent({ db, docId: 'session-1', fields: session() });
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

// --- editing the PARENT (design brief §4.6) ---------------------------------

test('a session with no children is judged on itself alone', async () => {
  const db = makeFakeDb({ 'cmsSchedule/session-parent': { dayId: 'day-2' } });
  assert.deepEqual(
    await checkSessionChildren({ db, docId: 'session-parent', fields: session({ dayId: 'day-3' }) }),
    { ok: true, errors: [] },
  );
});

test('moving a parent to another day is rejected, with the child count and the rule', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2' },
    'cmsSchedule/clinic-a': { dayId: 'day-2', parentId: 'session-parent' },
    'cmsSchedule/clinic-b': { dayId: 'day-2', parentId: 'session-parent' },
  });
  const verdict = await checkSessionChildren({
    db,
    docId: 'session-parent',
    fields: session({ dayId: 'day-3' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /^dayId: this session carries 2 child sessions \(clinic-a, clinic-b\)/);
  assert.match(verdict.errors[0], /running on "day-2"/);
  assert.match(verdict.errors[0], /cannot run on day "day-3"/);
  assert.match(verdict.errors[0], /a child session runs on its parent's day/);
});

test('one child reads as one child, not "1 child sessions"', async () => {
  const db = makeFakeDb({
    'cmsSchedule/session-parent': { dayId: 'day-2' },
    'cmsSchedule/clinic-a': { dayId: 'day-2', parentId: 'session-parent' },
  });
  const verdict = await checkSessionChildren({
    db,
    docId: 'session-parent',
    fields: session({ dayId: 'day-3' }),
  });
  assert.match(verdict.errors[0], /carries 1 child session \(clinic-a\)/);
});

test('an unpublished child counts, and its draft revision is what it is judged by', async () => {
  const db = makeFakeDb({
    'cmsSchedule/clinic-a': { dayId: 'day-2', parentId: 'session-parent' },
    // The draft has already moved with its parent; the live doc has not.
    'cmsSchedule_drafts/clinic-a': { dayId: 'day-3', parentId: 'session-parent' },
    'cmsSchedule_drafts/clinic-b': { dayId: 'day-2', parentId: 'session-parent' },
  });
  const verdict = await checkSessionChildren({
    db,
    docId: 'session-parent',
    fields: session({ dayId: 'day-3' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /carries 1 child session \(clinic-b\)/);
});

test('moving a parent to another line is rejected by the children that state one', async () => {
  const db = makeFakeDb({
    'cmsSchedule/inherits': { dayId: 'day-2', parentId: 'session-parent' },
    'cmsSchedule/states-b': { dayId: 'day-2', track: 'B', parentId: 'session-parent' },
  });
  const verdict = await checkSessionChildren({
    db,
    docId: 'session-parent',
    fields: session({ dayId: 'day-2', track: 'A' }),
  });
  assert.equal(verdict.ok, false);
  // The child that states nothing inherits the new line; only the one that
  // states B is stranded by the move.
  assert.match(verdict.errors[0], /^track: this session carries 1 child session \(states-b\) on "B"/);
  assert.match(verdict.errors[0], /cannot run on "A"/);
  assert.equal(verdict.errors.length, 1);
});

test('clearing a parent’s track strands the children that named it', async () => {
  const db = makeFakeDb({
    'cmsSchedule/states-b': { dayId: 'day-2', track: 'B', parentId: 'session-parent' },
  });
  const verdict = await checkSessionChildren({
    db,
    docId: 'session-parent',
    fields: session({ dayId: 'day-2' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /cannot run on no track/);
});

test('a parent that changes neither day nor line keeps its children', async () => {
  const db = makeFakeDb({
    'cmsSchedule/inherits': { dayId: 'day-2', parentId: 'session-parent' },
    'cmsSchedule/states-b': { dayId: 'day-2', track: 'B', parentId: 'session-parent' },
  });
  assert.deepEqual(
    await checkSessionChildren({
      db,
      docId: 'session-parent',
      fields: session({ dayId: 'day-2', track: 'B', title: 'Renamed' }),
    }),
    { ok: true, errors: [] },
  );
});

// --- the publish set (spec §8.4 step 3) -------------------------------------

test('a child in the publish set needs its parent live or published with it', async () => {
  const db = makeFakeDb({
    'cmsSchedule_drafts/parent': { dayId: 'day-2', status: 'dirty' },
    'cmsSchedule_drafts/child': { dayId: 'day-2', parentId: 'parent', status: 'dirty' },
  });
  const alone = await checkSchedulePublishSet({ db, docIds: ['child'] });
  assert.equal(alone.ok, false);
  assert.match(alone.errors[0], /^child: this session runs inside "parent", which is not published/);

  assert.deepEqual(
    await checkSchedulePublishSet({ db, docIds: ['child', 'parent'] }),
    { ok: true, errors: [] },
  );
});

test('a parent in the set but with no draft of its own does not count as published', async () => {
  // Naming an id that has nothing to publish cannot satisfy the rule:
  // publishDocs would report it `no-draft` and the child would still land
  // alone.
  const db = makeFakeDb({
    'cmsSchedule_drafts/child': { dayId: 'day-2', parentId: 'parent', status: 'dirty' },
  });
  const verdict = await checkSchedulePublishSet({ db, docIds: ['child', 'parent'] });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0], /which is not published/);
});

test('every stranded child is named, not just the first', async () => {
  const db = makeFakeDb({
    'cmsSchedule_drafts/a': { dayId: 'day-2', parentId: 'parent', status: 'dirty' },
    'cmsSchedule_drafts/b': { dayId: 'day-2', parentId: 'parent', status: 'dirty' },
  });
  const verdict = await checkSchedulePublishSet({ db, docIds: ['a', 'b'] });
  assert.equal(verdict.errors.length, 2);
});

test('an empty publish set reads nothing', async () => {
  const db = makeFakeDb();
  assert.deepEqual(await checkSchedulePublishSet({ db, docIds: [] }), { ok: true, errors: [] });
});

test('validateSessionStructure joins the halves, shape first', async () => {
  const db = dbWithTracks(['A']);
  const bad = await validateSessionStructure({
    db,
    docId: 'session-1',
    fields: session({ track: 'AA', parentId: 'session-ghost' }),
  });
  assert.equal(bad.ok, false);
  // The shape refusal comes back on its own: a malformed payload costs no
  // reads.
  assert.match(bad.message, /^track: /);
  assert.equal(bad.message.includes('parentId'), false);

  const good = await validateSessionStructure({
    db,
    docId: 'session-1',
    fields: session({ track: 'A' }),
  });
  assert.deepEqual(good, { ok: true });
});

test('one save reports everything wrong with it: track AND parent', async () => {
  const db = dbWithTracks(['A']);
  const verdict = await validateSessionStructure({
    db,
    docId: 'session-1',
    fields: session({ track: 'Z', parentId: 'session-ghost' }),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /track: "Z" is not one of this event's tracks/);
  assert.match(verdict.message, /no session exists with id "session-ghost"/);
});
