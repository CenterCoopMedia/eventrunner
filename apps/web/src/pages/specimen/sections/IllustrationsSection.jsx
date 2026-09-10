// Section 6: the illustration sets, four slots each.
//
// Each row below carries its own data-motif-set attribute, so every set
// draws at once and a reviewer can compare them without switching. The
// control under them writes the attribute on the document element instead,
// which is what a client's own choice does, so the rest of the page and the
// header change with it.
//
// The control is a demo device. It writes an attribute the provider owns,
// so the page puts the original value back when the reader leaves.
import { useEffect, useRef, useState } from 'react';
import { THEME_MOTIF_SET_IDS } from 'shared/theme';
import Motif, { MOTIF_SLOTS } from '../../../components/editorial/Motif.jsx';
import Figure from '../Figure.jsx';
import SpecimenSection from '../SpecimenSection.jsx';
import { IS_DEMO } from '../../../lib/demoMode.js';

const SET_LABEL = Object.freeze({
  none: 'None',
  botanical: 'Botanical',
  fauna: 'Fauna',
  cartographic: 'Cartographic',
});

function SetRow({ setId }) {
  return (
    <div
      data-motif-set={setId}
      className="specimen-motif-row grid gap-x-md gap-y-2xs border-t-hairline border-t-rule-hairline py-sm sm:grid-cols-[8rem,1fr]"
    >
      <p className="font-data text-caption font-semibold text-text-primary">
        {SET_LABEL[setId] ?? setId}
      </p>
      <ul className="flex flex-wrap gap-lg">
        {MOTIF_SLOTS.map((slot) => (
          <li key={slot} className="flex items-center gap-2xs">
            <Motif slot={slot} className="h-8 w-8" />
            <span className="font-data text-caption text-text-secondary">{slot}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MotifSetControl() {
  const [current, setCurrent] = useState('');
  const original = useRef(null);

  useEffect(() => {
    const root = document.documentElement;
    original.current = root.dataset.motifSet ?? null;
    setCurrent(root.dataset.motifSet ?? '');
    return () => {
      if (original.current === null) delete root.dataset.motifSet;
      else root.dataset.motifSet = original.current;
    };
  }, []);

  const choose = (setId) => {
    document.documentElement.dataset.motifSet = setId;
    setCurrent(setId);
  };

  return (
    <div className="flex flex-wrap items-center gap-xs" role="group" aria-label="Illustration set">
      {THEME_MOTIF_SET_IDS.map((setId) => (
        <button
          key={setId}
          type="button"
          aria-pressed={current === setId}
          onClick={() => choose(setId)}
          className={
            current === setId
              ? 'touch-target inline-flex items-center rounded-brand border-hairline border-rule-hairline bg-accent px-md py-2xs font-data text-caption font-semibold text-surface'
              : 'touch-target inline-flex items-center rounded-brand border-hairline border-rule-hairline px-md py-2xs font-data text-caption font-medium text-text-primary'
          }
        >
          {SET_LABEL[setId] ?? setId}
        </button>
      ))}
    </div>
  );
}

export default function IllustrationsSection() {
  return (
    <SpecimenSection
      id="specimen-illustrations"
      title="Illustrations"
      folio="Section 6"
      standfirst="Four slots in every set. The drawings take the site's own ink and carry no colour of their own."
    >
      <Figure
        name="Motif"
        file="components/editorial/Motif.jsx"
        contract="--motif-*"
        note="Each slot paints as a mask in the ink token. A motif is never an image element and never a background URL."
      >
        <div>
          {THEME_MOTIF_SET_IDS.map((setId) => (
            <SetRow key={setId} setId={setId} />
          ))}
        </div>
      </Figure>

      {IS_DEMO ? (
        <Figure
          name="Illustration set control"
          file="pages/specimen/sections/IllustrationsSection.jsx"
          contract={null}
          note="A demo control. It writes data-motif-set on the document element, which is what a client's own choice does, and puts the original value back when you leave this page."
        >
          <MotifSetControl />
        </Figure>
      ) : null}
    </SpecimenSection>
  );
}
