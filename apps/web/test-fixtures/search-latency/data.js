// Deterministic synthetic programme and directory for the search latency
// baseline (issue #1135). Every value comes from FIXTURE_SEED, so the before
// and after runs of a rendering change measure the same data.
export const FIXTURE_SEED = 1135;

function random(seed) {
  // mulberry32: small, fast and identical in every JavaScript engine.
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (next, list) => list[Math.floor(next() * list.length)];
const pad = (value) => String(value).padStart(2, '0');
const clock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

const FIRST = ['Ada', 'Amara', 'Bea', 'Chen', 'Dara', 'Elena', 'Femi', 'Grace', 'Hana', 'Idris', 'Jun', 'Kai', 'Lena',
  'Malik', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sami', 'Tara', 'Uma', 'Vik', 'Wen', 'Yara', 'Zoe'];
const LAST = ['Abara', 'Baker', 'Castillo', 'Dubois', 'Eze', 'Fischer', 'Gomez', 'Haddad', 'Ito', 'Jensen', 'Khan',
  'Lopez', 'Moreau', 'Nakamura', 'Okafor', 'Patel', 'Quispe', 'Rossi', 'Silva', 'Tanaka', 'Usman', 'Vargas', 'Wright'];
// The dense letter group: M names make up about a fifth of the directory.
const M_FIRST = ['Maria', 'Marco', 'Mariam', 'Mateo', 'Maya', 'Mei', 'Miguel', 'Mina', 'Moses', 'Musa'];
const ACCENTED = ['José Núñez', 'Élodie Lefèvre', 'Łukasz Wójcik', 'Søren Ørsted', 'Zoë Brontë', 'Ana Conceição',
  'Íñigo Muñoz', 'Chloé Dupré', 'Dvořák Šimon', 'Ömer Çelik'];
const LONG = 'Maximiliana Alejandra Konstantinopoulou-Featherstonehaugh de la Vega';
const DUPLICATE = 'Maria Garcia';
const ORGS = Array.from({ length: 40 }, (_, index) => `Newsroom ${String.fromCharCode(65 + (index % 26))}${index}`);
const ROLES = ['Reporter', 'Editor', 'Producer', 'Engineer', 'Director', 'Organizer', 'Designer', 'Researcher'];
const WORDS = ['local', 'data', 'civic', 'audio', 'video', 'trust', 'funding', 'elections', 'climate', 'health',
  'housing', 'education', 'archives', 'newsletters', 'community', 'investigations', 'product', 'audience'];
const FORMATS = ['talk', 'panel', 'workshop', 'lightning', 'roundtable', 'keynote', 'break'];

export const eventDays = [
  { id: 'day-1', label: 'Thursday', date: '2026-06-11', startTime: '08:00', endTime: '18:00' },
  { id: 'day-2', label: 'Friday', date: '2026-06-12', startTime: '08:00', endTime: '20:00' },
  { id: 'day-3', label: 'Saturday', date: '2026-06-13', startTime: '08:00', endTime: '14:00' },
];
export const DENSE_DAY = 'day-2';
export const eventTracks = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => ({ letter, name: `Line ${letter} programme` }));

function personName(next, index) {
  if (index % 97 === 0) return LONG;
  if (index % 53 === 0) return DUPLICATE;
  if (index % 41 === 0) return ACCENTED[(index / 41) % ACCENTED.length | 0];
  const first = next() < 0.2 ? pick(next, M_FIRST) : pick(next, FIRST);
  return `${first} ${pick(next, LAST)}`;
}

export function buildFixture() {
  const next = random(FIXTURE_SEED);
  const speakers = Array.from({ length: 160 }, (_, index) => ({
    id: `speaker-${index}`,
    displayName: personName(next, index + 1),
    organization: pick(next, ORGS),
    visible: true,
  }));

  // 300 published sessions: 60 on each short day and 180 on the dense day.
  // Every eighth top-level session gets two calling points (parentId).
  const scheduleData = [];
  const perDay = { 'day-1': 60, 'day-2': 180, 'day-3': 60 };
  for (const day of eventDays) {
    let made = 0;
    let parent = null;
    let slot = 0;
    while (made < perDay[day.id]) {
      const start = 8 * 60 + (slot % 40) * 15;
      const type = pick(next, FORMATS);
      const topic = `${pick(next, WORDS)} ${pick(next, WORDS)}`;
      const title = made % 37 === 0
        ? `A very long session title about ${topic}, collaboration across newsrooms, and what a reader should expect next`
        : `${topic[0].toUpperCase()}${topic.slice(1)} ${type}`;
      const isChild = parent && made % 8 !== 0 && made % 8 <= 2;
      const session = {
        id: `${day.id}-session-${made}`,
        dayId: day.id,
        title,
        type,
        track: type === 'break' ? null : eventTracks[made % eventTracks.length].letter,
        startTime: clock(start),
        endTime: clock(start + (isChild ? 10 : 45)),
        location: `Room ${1 + (made % 12)}`,
        description: `Synthetic ${type} on ${topic}.`,
        speakerIds: type === 'break' ? [] : [pick(next, speakers).id, pick(next, speakers).id],
        visible: true,
        order: made,
        ...(isChild ? { parentId: parent.id } : null),
      };
      if (!isChild) parent = session;
      scheduleData.push(session);
      made += 1;
      slot += 1;
    }
  }

  const countsById = new Map(scheduleData.map((session) => [session.id, Math.floor(next() * 400)]));

  // 1,000 directory entries, 60 percent public and 40 percent attendees only.
  const directory = Array.from({ length: 1000 }, (_, index) => ({
    id: `attendee-${index}`,
    displayName: personName(next, index + 7),
    organization: pick(next, ORGS),
    jobTitle: pick(next, ROLES),
    profileVisibility: next() < 0.6 ? 'public' : 'attendees_only',
    ...(index % 25 === 0 ? { speakerId: `speaker-${index % 160}` } : null),
  }));

  return { speakers, scheduleData, countsById, directory };
}

export const fixture = buildFixture();
