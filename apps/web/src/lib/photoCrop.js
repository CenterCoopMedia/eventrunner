// The crop step's arithmetic (issue #175).
//
// Pure: no React, no DOM, no canvas. The component turns these numbers into
// styles and strokes; this module owns the numbers, so the crop cannot
// drift between what the reader positions and what the canvas cuts.
//
// ONE RULE, STATED ONCE: the crop frame is square, and the smallest zoom
// is the size at which the picture covers that square edge to edge. A
// reader can zoom in and pan inside the picture, never outside it — there
// is no state of this control where the frame shows empty ground.

export const CROP_OUTPUT_SIZE = 512;

/**
 * The square cover layout: how large the picture is drawn at `zoom`, and
 * how far the frame's centre may travel.
 *
 * @param {{ imageWidth: number, imageHeight: number, viewport: number, zoom?: number }} args
 * @returns {{ drawWidth: number, drawHeight: number, minOffsetX: number, maxOffsetX: number, minOffsetY: number, maxOffsetY: number }}
 */
export function coverLayout({ imageWidth, imageHeight, viewport, zoom = 1 }) {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(viewport > 0)) {
    return { drawWidth: 0, drawHeight: 0, minOffsetX: 0, maxOffsetX: 0, minOffsetY: 0, maxOffsetY: 0 };
  }
  const safeZoom = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const cover = Math.max(viewport / imageWidth, viewport / imageHeight);
  const scale = cover * safeZoom;
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  // The picture's centre may leave the frame's centre by at most half the
  // overhang — past that, ground shows.
  const maxOffsetX = Math.max(0, (drawWidth - viewport) / 2) || 0;
  const maxOffsetY = Math.max(0, (drawHeight - viewport) / 2) || 0;
  return {
    drawWidth,
    drawHeight,
    minOffsetX: -maxOffsetX || 0,
    maxOffsetX,
    minOffsetY: -maxOffsetY || 0,
    maxOffsetY,
  };
}

/** Clamp an offset into the layout's range. Returns `{ x, y }`. */
export function clampOffset(x, y, layout) {
  const clamp = (value, min, max) => {
    const out = Math.min(Math.max(value, min), max);
    // Collapse -0: a clamped axis reads as "centred", and -0 is a printing
    // artefact, not a position.
    return out === 0 ? 0 : out;
  };
  return {
    x: clamp(x, layout.minOffsetX, layout.maxOffsetX),
    y: clamp(y, layout.minOffsetY, layout.maxOffsetY),
  };
}

/**
 * The source rectangle one viewport-sized square cut from the drawn
 * picture, for the canvas to scale into the output. Offsets are viewport
 * pixels relative to the frame's centre, the same numbers the component
 * keeps in state.
 *
 * @param {{ imageWidth: number, imageHeight: number, viewport: number, zoom: number, offsetX: number, offsetY: number }} args
 * @returns {{ sx: number, sy: number, sWidth: number, sHeight: number }}
 */
export function cropRectangle({ imageWidth, imageHeight, viewport, zoom, offsetX, offsetY }) {
  const layout = coverLayout({ imageWidth, imageHeight, viewport, zoom });
  const safe = clampOffset(offsetX, offsetY, layout);
  // The frame's top-left in drawn-picture pixels.
  const left = (layout.drawWidth - viewport) / 2 + safe.x;
  const top = (layout.drawHeight - viewport) / 2 + safe.y;
  // …in source-image pixels: divide by the scale the layout drew at.
  const cover = Math.max(viewport / imageWidth, viewport / imageHeight);
  const scale = cover * (Number.isFinite(zoom) && zoom >= 1 ? zoom : 1);
  return {
    sx: left / scale,
    sy: top / scale,
    sWidth: viewport / scale,
    sHeight: viewport / scale,
  };
}
