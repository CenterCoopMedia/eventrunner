import { CAPTION_ALIGNMENTS, CAPTION_MODES } from 'shared/imageCaption';
import EventHero from '../../../components/EventHero.jsx';
import ImageBlock from '../../../components/blocks/ImageBlock.jsx';
import { contentFieldHelp } from '../../contentFieldHelp.js';
import { SelectField } from '../formControls.jsx';

const displayLabels = {
  hidden: 'Hidden',
  below: 'Below the image',
  overlay: 'Overlay on the image',
  hover: 'On hover or focus',
};
const alignmentLabels = { left: 'Left', center: 'Center', right: 'Right' };

function choices(values, labels) {
  return [{ value: '', label: 'Use default' }, ...values.map((value) => ({ value, label: labels[value] }))];
}

const displayChoices = choices(CAPTION_MODES, displayLabels);
const alignmentChoices = choices(CAPTION_ALIGNMENTS, alignmentLabels);

export function ImagePlacementFields({ values, onChange, errorFor }) {
  return (
    <>
      <SelectField
        label="Caption display"
        help={contentFieldHelp('image', 'captionMode')}
        value={values.captionMode}
        options={displayChoices}
        onChange={(value) => onChange('captionMode', value)}
        error={errorFor('captionMode')}
      />
      <SelectField
        label="Caption alignment"
        help={contentFieldHelp('image', 'captionAlign')}
        value={values.captionAlign}
        options={alignmentChoices}
        onChange={(value) => onChange('captionAlign', value)}
        error={errorFor('captionAlign')}
      />
    </>
  );
}

export function ImagePlacementPreview({ image, hero, eventName, children }) {
  if (!image.url?.trim() || !image.alt?.trim()) return null;
  return (
    <div role="region" aria-label="Image preview" className="mt-sm min-w-0">
      <p className="mb-2xs text-admin-sm font-semibold text-admin-ink">Image preview</p>
      {children ?? (hero ? <EventHero name={eventName} image={image} compact={hero === 'schedule'} /> : <ImageBlock block={image} />)}
    </div>
  );
}
