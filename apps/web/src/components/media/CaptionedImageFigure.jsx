import { useEffect, useState } from 'react';
import { CAPTION_ALIGNMENTS, CAPTION_MODES } from 'shared/imageCaption';
import { isMediaLibraryPath } from 'shared/venue';
import { usePublicLanguage } from '../../contexts/PublicLanguageContext.jsx';
import { subscribeToFirebase } from '../../lib/firebaseLoader.js';
import './captionedImageFigure.css';

function useImageCaption(path) {
  const parts = isMediaLibraryPath(path) ? path.split('/') : [];
  const assetId = parts.length > 2 ? parts[1] : null;
  const [record, setRecord] = useState(null);
  useEffect(() => {
    if (!assetId) return undefined;
    return subscribeToFirebase(({ db, doc, onSnapshot }) => onSnapshot(
      doc(db, 'media_captions', assetId),
      (snapshot) => setRecord({ assetId, text: snapshot.data() }),
      () => setRecord({ assetId, text: null }),
    ), () => {});
  }, [assetId]);
  return record?.assetId === assetId ? record?.text : undefined;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export default function CaptionedImageFigure({ children, assetPath, placement, placedCaption, className, style, mediaClassName, fallback }) {
  const asset = useImageCaption(assetPath);
  const { language: pageLanguage, text: localized } = usePublicLanguage();
  const inheritedCaption = text(asset?.caption);
  const credit = text(asset?.credit);
  const mode = CAPTION_MODES.includes(placement.captionMode) ? placement.captionMode : undefined;
  const align = CAPTION_ALIGNMENTS.includes(placement.captionAlign) ? placement.captionAlign : undefined;
  const caption = mode === 'hidden' ? '' : placedCaption || inheritedCaption;
  const configured = (caption || credit) && (mode || align || credit || (!placedCaption && inheritedCaption));
  if (!configured) return fallback;

  const overlay = Boolean(caption) && mode === 'overlay';
  const hover = Boolean(caption) && mode === 'hover';
  const language = placement.publicLanguage;
  return (
    <figure
      className={[className, 'image-figure', overlay && 'image-figure--overlay', hover && 'image-figure--hover'].filter(Boolean).join(' ')}
      style={style}
      lang={language}
      data-caption-align={align ?? 'left'}
      tabIndex={hover ? 0 : undefined}
    >
      {mediaClassName || overlay ? (
        <div className={[mediaClassName, overlay && 'image-figure__media'].filter(Boolean).join(' ')}>{children}</div>
      ) : children}
      <figcaption className="image-figure__caption">
        {caption ? <span className="image-figure__text" lang={placedCaption ? language : 'en'}>{caption}</span> : null}
        {credit ? <small className="image-figure__credit" lang={pageLanguage}>{localized('Credit:', 'Crédito:')} {credit}</small> : null}
      </figcaption>
    </figure>
  );
}
