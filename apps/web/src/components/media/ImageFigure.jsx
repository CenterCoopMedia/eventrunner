import { lazy, Suspense } from 'react';

// A page can paint its photo while the optional caption code loads. Keep
// that plain figure if the enhancement chunk or its stylesheet fails.
const CaptionedImageFigure = lazy(() => import('./CaptionedImageFigure.jsx').catch(
  () => ({ default: ({ fallback }) => fallback }),
));

export default function ImageFigure({
  children,
  placement,
  assetPath,
  className,
  style,
  mediaClassName,
  legacyCaptionClass = 'mt-2xs font-data text-caption text-text-secondary',
}) {
  const placedCaption = typeof placement.caption === 'string' ? placement.caption.trim() : '';
  const legacyCaption = placement.captionMode === 'hidden' ? '' : placedCaption;
  const plain = legacyCaption || className || mediaClassName ? (
    <figure className={className} style={style} lang={placement.publicLanguage}>
      {mediaClassName ? <div className={mediaClassName}>{children}</div> : children}
      {legacyCaption ? <figcaption className={legacyCaptionClass}>{legacyCaption}</figcaption> : null}
    </figure>
  ) : children;
  if (!assetPath && !placement.captionMode && !placement.captionAlign) return plain;

  return (
    <Suspense fallback={plain}>
      <CaptionedImageFigure
        assetPath={assetPath}
        placement={placement}
        placedCaption={placedCaption}
        className={className}
        style={style}
        mediaClassName={mediaClassName}
        fallback={plain}
      >
        {children}
      </CaptionedImageFigure>
    </Suspense>
  );
}
