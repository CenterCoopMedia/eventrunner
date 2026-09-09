// VenueMap — the operator's uploaded plan of the building, and the same
// rooms in words beside it.
//
// THE LIST IS NOT A CAPTION. It is the accessible equal of the picture: a
// reader with images off, a reader on a screen reader, and a reader on a
// printout each learn every room this venue records, by name and floor,
// from text. The dots drawn on the plan repeat those names for the reader
// who can see it, so they carry `aria-hidden` — announcing them would read
// the room list twice, once as a list and once as scattered numbers.
//
// It draws no map of its own. The picture is whatever the operator uploaded
// through the media library, so a venue that publishes a floor plan gets its
// floor plan rather than a house-style diagram of a building nobody has
// seen. A hand-drawn SVG per deployment is exactly what this replaces.
//
// LIKE TransferLine, IT IS HANDED A FACT OR IT IS HANDED NOTHING. The
// resolving is shared/venue.cjs resolveVenueMap's job, including the rule
// that a picture with no alt text does not render at all; given `null` this
// renders nothing and the section around it disappears with it.
import AssetImage from './media/AssetImage.jsx';

/**
 * @param {{
 *   map: {
 *     image: string,
 *     alt: string,
 *     rooms: Array<{
 *       id: string, name: string, floor: string|null,
 *       number: number|null, x: number|null, y: number|null,
 *     }>,
 *   } | null,
 *   className?: string,
 * }} props
 */
export default function VenueMap({ map, className = '' }) {
  if (!map) return null;
  const marked = map.rooms.filter((room) => room.number !== null);

  return (
    <div className={['venue-map grid gap-lg md:grid-cols-3', className].filter(Boolean).join(' ')}>
      <div className="relative md:col-span-2">
        <AssetImage
          path={map.image}
          alt={map.alt}
          className="h-auto w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
        />
        {/* Decoration for the reader who can see the plan: the same numbers
            the list carries, sitting where the operator placed them. The
            coordinates are percentages, so a marker holds its spot at every
            size the picture is served at. */}
        {marked.map((room) => (
          <span
            key={room.id}
            aria-hidden="true"
            className="venue-map__marker absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-brand bg-accent font-data text-folio font-semibold text-surface"
            style={{ left: `${room.x}%`, top: `${room.y}%` }}
          >
            {room.number}
          </span>
        ))}
      </div>

      {map.rooms.length > 0 ? (
        <div>
          <h3 className="font-heading text-h3 font-semibold text-text-primary">
            Rooms at this venue
          </h3>
          <ul className="mt-sm flex flex-col">
            {map.rooms.map((room) => (
              <li
                key={room.id}
                className="flex gap-xs border-rule-hairline border-t-hairline pt-2xs mt-2xs first:mt-0 first:border-t-0 first:pt-0"
              >
                {/* The number is real text in both places, which is what
                    ties a dot on the plan to a name in the list. A room
                    nobody placed keeps the column, so the names still line
                    up down the list. */}
                <span className="w-6 shrink-0 font-data text-caption text-text-secondary">
                  {room.number ?? ''}
                </span>
                <span className="font-body text-body text-text-primary">
                  {room.name}
                  {room.floor ? (
                    <span className="block font-data text-caption text-text-secondary">
                      {room.floor}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
