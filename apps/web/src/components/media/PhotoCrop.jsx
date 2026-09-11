// PhotoCrop — the square crop step a photo field opens once a picture is
// chosen (issue #175).
//
// THE KEYBOARD IS THE FIRST-CLASS POINTER. The frame takes focus, and the
// arrow keys move the crop one step (Shift moves ten); the zoom control is
// a native range input, which the keyboard already operates; Apply and
// Cancel are real buttons. Dragging also works, because a mouse is fine —
// but nothing here requires one, which is the whole point: a control that
// can only be dragged is a control a keyboard reader cannot use.
//
// THE NUMBERS LIVE IN lib/photoCrop.js, and this component only draws
// them: the zoom's smallest value is the size at which the picture covers
// the square, and the offsets clamp so the frame never shows empty ground.
// The canvas cuts exactly the square the reader positioned, scaled to
// CROP_OUTPUT_SIZE, and hands the result upward as a File the field
// uploads through its existing path.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CROP_OUTPUT_SIZE, clampOffset, coverLayout, cropRectangle } from '../../lib/photoCrop.js';
import { primaryActionClass, quietActionClass } from '../controlClasses.js';

const VIEWPORT = 224; // px, the frame on screen
const PAN_STEP = 12; // px per arrow press
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

/**
 * @param {{
 *   file: File,
 *   label: string,              // what this photo is, for the copy: "your profile photo"
 *   onApply: (file: File) => void,
 *   onCancel: () => void,
 * }} props
 */
export default function PhotoCrop({ file, label, onApply, onCancel }) {
  const [image, setImage] = useState(null); // HTMLImageElement, once loaded
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const frameRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => setImage(element);
    element.onerror = () => setFailed(true);
    element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const layout = useMemo(
    () =>
      image
        ? coverLayout({
            imageWidth: image.naturalWidth,
            imageHeight: image.naturalHeight,
            viewport: VIEWPORT,
            zoom,
          })
        : null,
    [image, zoom],
  );

  useEffect(() => {
    // A zoom change re-clamps the pan: the frame must stay on the picture.
    if (!layout) return;
    setOffset((was) => {
      const next = clampOffset(was.x, was.y, layout);
      return next.x === was.x && next.y === was.y ? was : next;
    });
  }, [layout]);

  const pan = useCallback(
    (dx, dy) => {
      if (!layout) return;
      setOffset((was) => clampOffset(was.x + dx, was.y + dy, layout));
    },
    [layout],
  );

  function onKeyDown(event) {
    const step = event.shiftKey ? PAN_STEP * 5 : PAN_STEP;
    switch (event.key) {
      case 'ArrowLeft': pan(-step, 0); break;
      case 'ArrowRight': pan(step, 0); break;
      case 'ArrowUp': pan(0, -step); break;
      case 'ArrowDown': pan(0, step); break;
      default: return;
    }
    event.preventDefault();
  }

  function onPointerDown(event) {
    dragRef.current = { x: event.clientX, y: event.clientY, start: offset };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    if (!dragRef.current || !layout) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    setOffset(clampOffset(dragRef.current.start.x + dx, dragRef.current.start.y + dy, layout));
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function apply() {
    if (!image) return;
    // The cut is the exact square the reader positioned, scaled to the
    // output size (lib/photoCrop.js owns the rectangle).
    const element = document.createElement('canvas');
    element.width = CROP_OUTPUT_SIZE;
    element.height = CROP_OUTPUT_SIZE;
    const context = element.getContext('2d');
    if (!context) {
      setFailed(true);
      return;
    }
    // cropRectangle recomputes from the same state the frame is drawn
    // with, so what was on screen is what lands in the file.
    const rect = cropRectangle({
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      viewport: VIEWPORT,
      zoom,
      offsetX: offset.x,
      offsetY: offset.y,
    });
    context.drawImage(image, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
    element.toBlob((blob) => {
      if (!blob) {
        setFailed(true);
        return;
      }
      const extension = blob.type === 'image/png' ? 'png' : 'jpg';
      onApply(new File([blob], `cropped.${extension}`, { type: blob.type }));
    }, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92);
  }

  if (failed) {
    return (
      <div role="alert" className="mt-sm font-data text-caption text-danger">
        That picture could not be opened. Try a different file.
        <div className="mt-xs">
          <button type="button" className={quietActionClass} onClick={onCancel}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-sm flex flex-col gap-sm">
      <div className="flex flex-wrap items-start gap-md">
        {/* The frame. One tab stop; the instructions are its accessible
            description, and every arrow is a real, stated move. */}
        <div
          ref={frameRef}
          role="application"
          aria-label={`Position the crop for ${label}`}
          aria-describedby={`crop-instructions-${file.name.length}`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative cursor-move touch-none overflow-hidden rounded-brand border-hairline border-rule-hairline bg-surface-alt select-none"
          style={{ width: VIEWPORT, height: VIEWPORT }}
        >
          {image ? (
            <img
              src={image.src}
              alt=""
              draggable={false}
              // The offsets as data, for tests: jsdom's style serializer
              // rewrites calc(), so the rendered numbers travel here.
              data-offset-x={offset.x}
              data-offset-y={offset.y}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: layout?.drawWidth,
                height: layout?.drawHeight,
                left: `calc(50% + ${offset.x}px - ${layout ? layout.drawWidth / 2 : 0}px)`,
                top: `calc(50% + ${offset.y}px - ${layout ? layout.drawHeight / 2 : 0}px)`,
              }}
            />
          ) : (
            <span className="flex h-full items-center justify-center font-data text-caption text-text-secondary">
              Loading…
            </span>
          )}
        </div>
        <p id={`crop-instructions-${file.name.length}`} className="max-w-prose text-body text-text-secondary">
          Use the arrow keys to move the picture inside the square — hold Shift to move faster —
          and the slider to zoom. What the square shows is what gets saved.
        </p>
      </div>

      <div>
        <label htmlFor="crop-zoom" className="block font-data text-caption font-semibold text-text-primary">
          Zoom
        </label>
        <input
          id="crop-zoom"
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="mt-3xs w-64 max-w-full"
        />
      </div>

      <div className="flex flex-wrap gap-xs">
        <button type="button" className={primaryActionClass} onClick={apply} disabled={!image}>
          Use this crop
        </button>
        <button type="button" className={quietActionClass} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
