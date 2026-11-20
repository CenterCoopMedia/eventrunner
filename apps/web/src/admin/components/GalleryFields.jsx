// The gallery block's fields (#1176): the layout, picked by its picture;
// the pictures, chosen from the media library, each with its alt text, in
// an order set by drag or by the Up and Down buttons; an optional name for
// screen readers; and a preview drawn by the public renderer in the site's
// theme, so the block looks here as it will on the page.
import { useEffect, useId, useRef, useState } from 'react';
import SectionBlocks from '../../components/blocks/SectionBlocks.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { assetUrl } from '../../lib/mediaSource.js';
import { bundledDemoAssetUrl } from '../../lib/bundledAssets.js';
import { applyThemePreview, releaseThemePreviewTarget } from '../themePreview.js';
import { moveItem } from '../reorder.js';
import { contentFieldHelp } from '../contentFieldHelp.js';
import AdminIconControl from './AdminIconControl.jsx';
import ModalShell from './media/ModalShell.jsx';
import MediaLibrary from './media/MediaLibrary.jsx';
import { ReorderControls, OrderAnnouncement, bindReorderDrop } from './ReorderControls.jsx';
import {
  FieldError,
  TextField,
  fieldHintClass,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';
import './galleryFields.css';

const LAYOUTS = Object.freeze([
  { id: 'grid', name: 'Grid', summary: 'Every picture at once, in rows.' },
  { id: 'carousel', name: 'Carousel', summary: 'Several in a row that readers scroll sideways.' },
  { id: 'slideshow', name: 'Slideshow', summary: 'One picture at a time, with Previous and Next.' },
]);

function LayoutPicture({ id }) {
  const box = (x, y, w, h, key) => <rect key={key} x={x} y={y} width={w} height={h} rx="1.5" />;
  let shapes;
  if (id === 'grid') {
    shapes = [0, 1, 2, 3, 4, 5].map((n) => box(4 + (n % 3) * 20, 4 + Math.floor(n / 3) * 16, 17, 13, n));
  } else if (id === 'carousel') {
    shapes = [box(4, 10, 22, 16, 'a'), box(29, 10, 22, 16, 'b'), box(54, 10, 10, 16, 'c')];
  } else {
    shapes = [box(10, 4, 44, 28, 'a')];
  }
  return (
    <svg viewBox="0 0 68 36" width="68" height="36" aria-hidden="true" className="admin-gallery-layout__picture">
      {shapes}
    </svg>
  );
}

function thumbnailSrc(url) {
  return bundledDemoAssetUrl(url) ?? assetUrl(url);
}

/**
 * @param {{
 *   values: { images: Array<{url: string, alt: string}>, layout: string, label: string },
 *   onChange: (fieldId: string, value: unknown) => void,
 *   errorFor: (name: string) => string|undefined,
 * }} props
 */
export default function GalleryFields({ values, onChange, errorFor }) {
  const id = useId();
  const images = Array.isArray(values.images) ? values.images : [];
  const [choosing, setChoosing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const chooseRef = useRef(null);

  const setImages = (next) => onChange('images', next);
  const move = (from, to) => {
    const next = moveItem(images, from, to);
    if (next === images) return;
    setImages(next);
    setAnnouncement(`Picture moved to position ${to + 1} of ${images.length}.`);
  };
  const remove = (index) => {
    setImages(images.filter((_, at) => at !== index));
    setAnnouncement(`Picture ${index + 1} removed. ${images.length - 1} left.`);
    chooseRef.current?.focus();
  };
  // A tile in the library adds the picture, or takes it out when it is
  // already in the gallery. Alt text starts from the library's description.
  const toggle = (asset) => {
    if (!asset) return;
    if (images.some((image) => image.url === asset.path)) {
      setImages(images.filter((image) => image.url !== asset.path));
    } else {
      setImages([...images, { url: asset.path, alt: typeof asset.alt === 'string' ? asset.alt : '' }]);
    }
  };

  const layoutError = errorFor('layout');
  const imagesError = errorFor('images');

  return (
    <div className="admin-gallery-fields sm:col-span-2">
      <fieldset className="admin-gallery-layout" aria-describedby={layoutError ? `${id}-layout-error` : undefined}>
        <legend className={fieldLabelClass}>Layout</legend>
        <p className={fieldHintClass}>{contentFieldHelp('gallery', 'layout')}</p>
        <div className="admin-gallery-layout__options">
          {LAYOUTS.map((layout) => (
            <label key={layout.id} className="admin-gallery-layout__option" data-selected={values.layout === layout.id || undefined}>
              <span className="admin-gallery-layout__head">
                <input data-help-skip="Each layout option shows a picture and a one-line description."
                  type="radio"
                  name={`${id}-layout`}
                  value={layout.id}
                  checked={values.layout === layout.id}
                  onChange={() => onChange('layout', layout.id)}
                  aria-describedby={`${id}-${layout.id}-summary`}
                />
                <span className="font-semibold">{layout.name}</span>
              </span>
              <LayoutPicture id={layout.id} />
              <span id={`${id}-${layout.id}-summary`} className={fieldHintClass}>{layout.summary}</span>
            </label>
          ))}
        </div>
        <FieldError id={`${id}-layout-error`} message={layoutError} />
      </fieldset>

      <fieldset className="admin-gallery-images" aria-describedby={imagesError ? `${id}-images-error` : undefined}>
        <legend className={fieldLabelClass}>Pictures</legend>
        <p className={fieldHintClass}>{contentFieldHelp('gallery', 'images')}</p>
        {images.length ? (
          <ol className="admin-gallery-images__list">
            {images.map((image, index) => (
              <li
                // A picture appears once (the server refuses a repeat), so
                // its path keys the row through every move.
                key={image.url}
                className="admin-gallery-images__row"
                {...bindReorderDrop('gallery:', index, move)}
              >
                <ReorderControls
                  label={`picture ${index + 1}`}
                  index={index}
                  count={images.length}
                  dragToken={`gallery:${index}`}
                  onMove={move}
                />
                <span className="admin-gallery-images__frame">
                  {thumbnailSrc(image.url) ? <img src={thumbnailSrc(image.url)} alt="" /> : null}
                </span>
                <div className="admin-gallery-images__alt">
                  <TextField
                    help={contentFieldHelp('image', 'alt')}
                    label={`Alt text for picture ${index + 1}`}
                    value={image.alt}
                    onChange={(alt) => setImages(images.map((entry, at) => (at === index ? { ...entry, alt } : entry)))}
                    error={errorFor(`images.${index + 1}.alt`)}
                    required
                  />
                  <FieldError id={`${id}-picture-${index + 1}-error`} message={errorFor(`images.${index + 1}.url`)} />
                </div>
                <AdminIconControl
                  label={`Remove picture ${index + 1}`}
                  icon="remove"
                  className={secondaryButtonClass}
                  onClick={() => remove(index)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <p className={fieldHintClass}>No pictures yet.</p>
        )}
        <OrderAnnouncement message={announcement} />
        <button ref={chooseRef} type="button" className={secondaryButtonClass} onClick={() => setChoosing(true)}>
          Choose pictures…
        </button>
        <FieldError id={`${id}-images-error`} message={imagesError} />
      </fieldset>

      <TextField
        label="Gallery name (optional)"
        help={contentFieldHelp('gallery', 'label')}
        value={values.label ?? ''}
        onChange={(label) => onChange('label', label)}
        error={errorFor('label')}
      />

      <GalleryPreview values={values} />

      {choosing ? (
        <ModalShell
          title="Choose pictures"
          description="Select each picture to add it or take it out. Upload a new one if you need it."
          onClose={() => setChoosing(false)}
          returnFocusRef={chooseRef}
        >
          <MediaLibrary
            folder="cms-images"
            selectedPaths={images.map((image) => image.url)}
            onSelect={toggle}
          />
          <button type="button" className={`${primaryButtonClass} self-end`} onClick={() => setChoosing(false)}>
            Done
          </button>
        </ModalShell>
      ) : null}
    </div>
  );
}

/** The public renderer, in the site's theme. Draws only what the page would. */
function GalleryPreview({ values }) {
  const { publicTheme: theme } = useEventConfig();
  const ref = useRef(null);
  useEffect(() => {
    const target = ref.current;
    if (!theme || !target) return undefined;
    applyThemePreview(theme, { scopes: [{ element: target, id: 'admin-gallery-preview' }] });
    return () => releaseThemePreviewTarget(target);
  }, [theme]);
  const block = {
    id: 'gallery-preview',
    section: 'preview',
    field: 'gallery',
    blockType: 'gallery',
    images: values.images,
    layout: values.layout,
    label: values.label,
  };
  const empty = !(Array.isArray(values.images) && values.images.some((image) => image.alt?.trim()));
  const headingId = useId();
  return (
    <section className="admin-gallery-preview" aria-labelledby={headingId}>
      <h3 id={headingId} className={fieldLabelClass}>Preview</h3>
      <div ref={ref} className="admin-gallery-preview__frame">
        {empty ? (
          <p className={fieldHintClass}>Pictures with alt text appear here as the page will show them.</p>
        ) : (
          <SectionBlocks blocks={[block]} />
        )}
      </div>
    </section>
  );
}
