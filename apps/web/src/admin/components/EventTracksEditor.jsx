import { useRef, useState } from 'react';
import { Panel, TextField } from './formControls.jsx';
import {
  AddItemButton,
  RemovalWarning,
  RemoveItemButton,
  afterRender,
  usageSentence,
} from './listItemControls.jsx';

// The event tracks (design brief §4.6, issue #475): a letter and a name per
// line, in the order the schedule draws its columns. Sessions name a track
// by its letter, so the letter is the stored identity. A new track starts
// on the first letter that no track has and no session still names. A
// saved track's letter can change, but if sessions use it the field says
// so, because those sessions lose their track on save.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

let rowCount = 0;
/** A form-only key per row. Never stored. */
const rowKey = () => `track-row-${(rowCount += 1)}`;

const capital = (letter) => String(letter ?? '').trim().toUpperCase();

/**
 * The stored tracks as form rows. `savedLetter` is the letter sessions may
 * point at; a new row has none.
 *
 * @param {unknown} tracks config/event.tracks
 */
export function normalizeTracks(tracks) {
  return Array.isArray(tracks)
    ? tracks.map((track) => ({
      key: rowKey(),
      letter: track?.letter ?? '',
      name: track?.name ?? '',
      savedLetter: capital(track?.letter),
    }))
    : [];
}

/**
 * The rows as updateEventConfig takes them. A letter is a wayfinding mark,
 * so it is always sent as a capital: the server accepts A-Z only, and staff
 * should not have to know that to type one.
 */
export function tracksPayload(tracks) {
  return tracks.map((track) => ({ letter: capital(track.letter), name: track.name }));
}

/**
 * The first letter no track has and no session names; '' when all 26 are
 * taken.
 *
 * @param {{ letter: string }[]} tracks
 * @param {Map<string, unknown>|Set<string>} reserved
 */
export function nextTrackLetter(tracks, reserved) {
  const taken = new Set(tracks.map((track) => capital(track.letter)));
  return [...LETTERS].find((letter) => !taken.has(letter) && !reserved.has(letter)) ?? '';
}

const trackName = (track) => [capital(track.letter), track.name.trim()].filter(Boolean).join(' ');

/**
 * @param {object} props
 * @param {object[]} props.tracks the form rows (normalizeTracks)
 * @param {(tracks: object[]) => void} props.onChange
 * @param {(field: string) => string|undefined} props.errorFor
 * @param {Map<string, string[]>} props.trackUsage letter → titles of the live and draft sessions on it
 * @param {boolean} [props.usageReady] both session lists have loaded and are listening
 */
export default function EventTracksEditor({ tracks, onChange, errorFor, trackUsage, usageReady = true }) {
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(null);
  const listRef = useRef(null);
  const addRef = useRef(null);
  const removeRefs = useRef(new Map());

  const usesOf = (track) => (track.savedLetter ? trackUsage.get(track.savedLetter) ?? [] : []);

  /**
   * Sessions that already carry this row's new letter and that no other
   * track keeps (sessions left by a removed or relettered track). Giving
   * this row that letter puts them in it on save. This warns rather than
   * blocks: putting those sessions back in a track may be exactly what
   * staff mean, and the letter field says so before the save.
   */
  const joiningSessions = (index) => {
    const track = tracks[index];
    const letter = capital(track.letter);
    if (!letter || letter === track.savedLetter) return [];
    const keptElsewhere = tracks.some((other, i) => (
      i !== index && other.savedLetter === letter && capital(other.letter) === letter
    ));
    return keptElsewhere ? [] : trackUsage.get(letter) ?? [];
  };

  const focusRemoveAt = (rows, index) => {
    const key = (rows[index] ?? rows[index - 1])?.key;
    const target = (key ? removeRefs.current.get(key) : null) ?? addRef.current;
    target?.focus();
  };

  const setTrack = (index, patch) => onChange(tracks.map((track, i) => (i === index ? { ...track, ...patch } : track)));

  const add = () => {
    if (!usageReady) return;
    const track = { key: rowKey(), letter: nextTrackLetter(tracks, trackUsage), name: '', savedLetter: '' };
    onChange([...tracks, track]);
    setNotice('');
    afterRender(() => listRef.current?.querySelector(`[data-row-key="${track.key}"]`)?.focus());
  };

  const remove = (index) => {
    const track = tracks[index];
    const next = tracks.filter((_, i) => i !== index);
    setConfirming(null);
    onChange(next);
    const letter = capital(track.letter);
    const named = [letter ? `Track ${letter}` : `Track ${index + 1}`, track.name.trim()].filter(Boolean).join(', ');
    setNotice(`${named}${track.name.trim() ? ',' : ''} will be removed when you save.`);
    afterRender(() => focusRemoveAt(next, index));
  };

  const requestRemove = (index) => {
    if (!usageReady) return;
    if (usesOf(tracks[index]).length > 0) setConfirming(tracks[index].key);
    else remove(index);
  };

  return (
    <Panel
      className="admin-settings-card"
      title="Tracks"
      description="Sessions that run at the same time, on separate lines. Each line has a letter and a name, and the schedule shows both. Leave this empty if everything happens in one room."
      actions={<AddItemButton ref={addRef} onClick={add} unavailable={!usageReady}>Add track</AddItemButton>}
    >
      {usageReady ? null : (
        <p className="mb-sm text-admin-sm text-admin-ink-secondary">
          Checking which sessions use these tracks. You can add and remove tracks when that is done.
        </p>
      )}
      {notice ? <p role="status" className="mb-sm text-admin-sm text-admin-ink-secondary">{notice}</p> : null}
      {tracks.length === 0 ? (
        <p className="text-admin-sm text-admin-ink-secondary">No tracks configured yet.</p>
      ) : (
        <ol ref={listRef} className="admin-settings-row-list">
          {tracks.map((track, index) => {
            const n = index + 1;
            const uses = usageReady ? usesOf(track) : [];
            const letter = capital(track.letter);
            const joining = usageReady ? joiningSessions(index) : [];
            const headingId = `${track.key}-heading`;
            const relettered = uses.length > 0 && letter !== track.savedLetter;
            const shownLetter = track.savedLetter || letter;
            return (
              <li key={track.key} className="admin-settings-row-card" aria-labelledby={headingId}>
                <div className="admin-settings-row-heading">
                  <h3 id={headingId} className="min-w-0 break-words text-admin-base font-bold text-admin-ink">
                    Track {n}
                    {trackName(track) ? <span className="font-normal text-admin-ink-secondary">: {trackName(track)}</span> : null}
                  </h3>
                  <RemoveItemButton
                    ref={(node) => {
                      if (node) removeRefs.current.set(track.key, node);
                      else removeRefs.current.delete(track.key);
                    }}
                    name={`Remove track ${n}${trackName(track) ? `, ${trackName(track)}` : ''}`}
                    onClick={() => requestRemove(index)}
                    unavailable={!usageReady}
                  />
                </div>
                <div className="admin-settings-fields">
                  <TextField
                    label={`Track ${n} letter`}
                    value={track.letter}
                    onChange={(value) => setTrack(index, { letter: value })}
                    error={errorFor(`tracks[${index}].letter`)}
                    maxLength={1}
                    hint="One letter, A to Z. It is how a reader tells the lines apart."
                    warning={[
                      relettered
                        ? `${uses.length} session${uses.length === 1 ? ' uses' : 's use'} letter ${track.savedLetter}. Change their track too, or they lose it when you save.`
                        : '',
                      joining.length > 0
                        ? `${joining.length} session${joining.length === 1 ? ' already uses' : 's already use'} letter ${letter}. ${joining.length === 1 ? 'It joins' : 'They join'} this track when you save.`
                        : '',
                    ].filter(Boolean).join(' ')}
                  />
                  <TextField
                    label={`Track ${n} name`}
                    value={track.name}
                    onChange={(value) => setTrack(index, { name: value })}
                    error={errorFor(`tracks[${index}].name`)}
                    hint="Shown beside the letter, e.g. Practice."
                    data-row-key={track.key}
                  />
                </div>
                {uses.length > 0 ? (
                  <p className="mt-sm text-admin-sm text-admin-ink-secondary">{usageSentence(uses)}</p>
                ) : null}
                {confirming === track.key ? (
                  <RemovalWarning
                    title={`Remove track ${shownLetter}?`}
                    consequence={`${uses.length} session${uses.length === 1 ? ' uses' : 's use'} track ${shownLetter}. ${uses.length === 1
                      ? 'It stays saved, but it loses its track and runs across the whole schedule until you give it another track.'
                      : 'They stay saved, but they lose their track and run across the whole schedule until you give each one another track.'} Nothing changes until you save.`}
                    confirmLabel={`Remove track ${shownLetter} anyway`}
                    keepLabel={`Keep track ${shownLetter}`}
                    onConfirm={() => remove(index)}
                    onKeep={() => {
                      setConfirming(null);
                      afterRender(() => focusRemoveAt(tracks, index));
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/**
 * After a save lands, each row the save carried is stored with the letter
 * it was SENT with, which is what sessions can now point at. A letter typed
 * while the save was running is not saved yet, and a row added meanwhile
 * keeps no saved letter.
 *
 * @param {object[]} tracks the rows as they stand now
 * @param {Map<string, string>} submitted row key → the letter in the saved payload
 */
export function markTracksSaved(tracks, submitted) {
  return tracks.map((track) => (
    submitted.has(track.key) ? { ...track, savedLetter: submitted.get(track.key) } : track
  ));
}

/** Row key → the letter the payload carries, taken when a save starts. */
export function submittedTrackLetters(tracks) {
  return new Map(tracks.map((track) => [track.key, capital(track.letter)]));
}
