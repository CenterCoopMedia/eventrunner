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
// A MISSING PICTURE IS NOT A MESSAGE. AssetImage prints "This file is
// missing from storage." where an object has gone, which is the right thing
// in the admin media library — an operator can act on it — and the wrong
// thing on a public page, where it is a maintenance note addressed to
// somebody the reader has never met. So this reads the URL itself, and an
// object path that cannot be resolved, or an image the browser fails to
// load, takes the WHOLE device with it: no heading, no room list, and above
// all no markers, because numbered dots floating over nothing are a diagram
// of a building that is not there.
//
// LIKE TransferLine, IT IS HANDED A FACT OR IT IS HANDED NOTHING. The
// resolving is shared/venue.cjs resolveVenueMap's job, including the rule
// that a picture with no alt text does not render at all.
import { useCallback, useEffect, useState } from 'react';
import { assetUrl } from '../lib/mediaSource.js';

/**
 * The map's image, or `null` when there is nothing to draw.
 *
 * A HOOK RATHER THAN STATE INSIDE THE COMPONENT, because the caller has to
 * know the answer too: it is the one that renders the section heading around
 * this device, and a heading over a picture that never arrives is the empty
 * section the whole page model exists to avoid. Called unconditionally, so
 * it obeys the rules of hooks whatever the caller decides afterwards.
 *
 * @param {{ image: string } | null} map a resolved venue map
 * @returns {{ src: string, onError: () => void } | null}
 */
export function useVenueMapImage(map) {
  const src = map ? assetUrl(map.image) : null;
  const [failedSrc, setFailedSrc] = useState(null);
  const onError = useCallback(() => setFailedSrc(src), [src]);

  // A new picture is a new chance: clear a previous failure so one deleted
  // object does not hide every map chosen after it.
  useEffect(() => {
    setFailedSrc((current) => (current === src ? current : null));
  }, [src]);

  if (!src || failedSrc === src) return null;
  return { src, onError };
}

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
 *   image: { src: string, onError: () => void } | null,
 *   className?: string,
 * }} props
 */
export default function VenueMap({ map, image, className = '' }) {
  if (!map || !image) return null;
  const marked = map.rooms.filter((room) => room.number !== null);

  return (
    <div className={['venue-map grid gap-lg md:grid-cols-3', className].filter(Boolean).join(' ')}>
      <div className="venue-map__frame md:col-span-2">
        {/* The frame is the picture and nothing more (index.css): it shrinks
            to whatever box the image's own proportions make. It cannot hold
            a shape of its own, because the markers below are positioned
            against THIS box — a frame wider or taller than the plan inside
            it letterboxes the plan and puts every marker on the wrong room.
            The cost is a single layout shift when the bytes arrive, which
            nothing here can reserve against: a stored map is a path and a
            sentence, not a width and a height. */}
        <img
          src={image.src}
          alt={map.alt}
          loading="lazy"
          onError={image.onError}
          className="venue-map__image rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
        />
        {/* Decoration for the reader who can see the plan: the same numbers
            the list carries, sitting where the operator placed them. The
            coordinates are percentages of the picture — which is what the
            frame above is — so a marker holds its spot at every size the
            picture is served at. */}
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
                className="mt-2xs flex gap-xs border-rule-hairline border-t-hairline pt-2xs first:mt-0 first:border-t-0 first:pt-0"
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
