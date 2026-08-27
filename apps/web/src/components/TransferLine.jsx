// TransferLine — "where you are, where it is, how long it takes" (design
// brief §4.6), and now with something true to say.
//
// THIS COMPONENT MAKES NO CLAIM OF ITS OWN. It takes a movement record that
// shared/venue.cjs resolveMovement has already found — an operator wrote it
// down, naming both ends and the walk in whole minutes — and renders it.
// Given `null` it renders nothing. There is no estimate, no fallback, no
// "about 5 minutes", and no reversing of a route recorded the other way:
// every one of those was available to the old version of this line, which
// compared two room strings and printed a sentence about a move nobody had
// recorded. That version was deleted. This one cannot repeat it, because it
// is handed a fact or it is handed nothing.
//
// THE CALLER OWNS THE OTHER HALF OF THE CLAIM, and this is the part that
// matters. A movement record says what it costs to go from one place to
// another. It does NOT say that this reader is going. So this line renders
// in exactly two places, both of which have a stated sequence:
//
//   • My schedule — between two sessions the reader BOOKMARKED. They said
//     they are attending both, in that order, on that day.
//   • Calling points — from a parent session to a child in a different
//     place. Being in the workshop is being in the workshop's room, and the
//     clinic inside it is somewhere else.
//
// It renders nowhere on the full schedule, because a reader scanning the
// programme is not walking it in order: they skipped that session, or they
// are following one track out of five.
//
// IT IS NOT PRESET-DECORATION. The old line was switched on by an Atlas
// token and hidden everywhere else, which was defensible when it was a
// flourish in a story about a transport network. A recorded walking time is
// a FACT, and a fact that five presets hide is a fact withheld from the
// reader who needed it most. Presets may style this line. None may suppress
// it.
import WayfindingIcon from './editorial/WayfindingIcon.jsx';

/**
 * The walk, in words.
 *
 * Zero is a recorded answer meaning "across the corridor", not a missing
 * one, and "0 min walk" reads like a bug. The field is whole minutes, so a
 * recorded 0 is faithfully "under a minute" — a reading of the number
 * stated, not a number invented.
 *
 * @param {number} minutes
 */
function walkLabel(minutes) {
  if (minutes === 0) return 'under a minute’s walk';
  return `${minutes} min walk`;
}

/**
 * @param {{
 *   movement: {
 *     from: { id: string, name: string, floor?: string },
 *     to: { id: string, name: string, floor?: string },
 *     walkingMinutes: number,
 *     accessibleRoute: string|null,
 *   } | null,
 *   className?: string,
 * }} props
 */
export default function TransferLine({ movement, className = '' }) {
  if (!movement) return null;
  const { from, to, walkingMinutes, accessibleRoute } = movement;

  return (
    <div className={['transfer-line', className].filter(Boolean).join(' ')}>
      {/* One sentence, in signage voice: where you are, where it is, how
          long it takes. The icon is labelled by the words beside it, which
          is the rule the whole sign set follows. */}
      <p className="transfer-line__move font-data text-caption text-text-secondary">
        <WayfindingIcon name="walk" className="me-2xs" />
        Transfer from {from.name} to {to.name}
        {to.floor ? `, ${to.floor}` : ''} — {walkLabel(walkingMinutes)}
      </p>
      {/* The step-free way, in the operator's own words. Absent means the
          venue has not surveyed one and the site says nothing — never
          "there isn't one". */}
      {accessibleRoute ? (
        <p className="transfer-line__route mt-3xs font-data text-caption text-text-secondary">
          <WayfindingIcon name="step-free" className="me-2xs" />
          Step-free route: {accessibleRoute}
        </p>
      ) : null}
    </div>
  );
}
