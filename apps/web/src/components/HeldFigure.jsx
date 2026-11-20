import { useRef } from 'react';
import { useFigureTurn } from '../lib/heldFigures.js';
import './heldFigure.css';

/**
 * The held-up figure (#1090; design/tokens/motifs.json `$wait-note`): the
 * active motif set's wait drawing, or the ampersand when the set has none.
 * theme.css resolves which one shows, so nothing here names a set. It is
 * decoration: the words beside it carry the wait. A page shows one figure,
 * so a figure draws only on its turn (lib/heldFigures.js); `still` figures,
 * as in the specimen book, always draw.
 *
 * @param {{ stage: string, still?: boolean }} props
 */
export default function HeldFigure({ stage, still = false }) {
  const ref = useRef(null);
  const turn = useFigureTurn(ref, still);
  return (
    <span ref={ref} aria-hidden="true" className="held-figure" data-held-stage={stage}>
      {turn ? (
        <>
          <span className="held-figure__glyph">&amp;</span>
          <span className="held-figure__body" />
          <span className="held-figure__part" />
        </>
      ) : null}
    </span>
  );
}
