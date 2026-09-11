// lib/photoCrop.js — the crop step's arithmetic (issue #175).
import { describe, expect, it } from 'vitest';
import { clampOffset, coverLayout, cropRectangle } from './photoCrop.js';

// A wide picture against a 200px square: the cover scale is the LARGER of
// 200/400 and 200/200 — the height governs, so the scale is 1 and the
// width overhangs.
const WIDE = { imageWidth: 400, imageHeight: 200, viewport: 200 };

describe('coverLayout', () => {
  it('the smallest zoom covers the square edge to edge', () => {
    const layout = coverLayout({ ...WIDE, zoom: 1 });
    expect(layout.drawWidth).toBe(400);
    expect(layout.drawHeight).toBe(200);
    // Width overhangs by 100px each side; height fits exactly.
    expect(layout.minOffsetX).toBe(-100);
    expect(layout.maxOffsetX).toBe(100);
    expect(layout.minOffsetY).toBe(0);
    expect(layout.maxOffsetY).toBe(0);
  });

  it('zooming in opens the travel range in both axes', () => {
    const layout = coverLayout({ ...WIDE, zoom: 2 });
    expect(layout.drawWidth).toBe(800);
    expect(layout.drawHeight).toBe(400);
    expect(layout.maxOffsetX).toBe(300);
    expect(layout.maxOffsetY).toBe(100);
  });

  it('a portrait picture travels vertically instead', () => {
    const layout = coverLayout({ imageWidth: 100, imageHeight: 300, viewport: 100, zoom: 1 });
    expect(layout.drawWidth).toBe(100);
    expect(layout.drawHeight).toBe(300);
    expect(layout.maxOffsetX).toBe(0);
    expect(layout.maxOffsetY).toBe(100);
  });

  it('nonsense dimensions draw nothing rather than throwing', () => {
    const layout = coverLayout({ imageWidth: 0, imageHeight: 0, viewport: 100 });
    expect(layout.drawWidth).toBe(0);
    expect(layout.maxOffsetX).toBe(0);
  });
});

describe('clampOffset', () => {
  it('keeps the frame inside the picture', () => {
    const layout = coverLayout({ ...WIDE, zoom: 1 });
    expect(clampOffset(-120, 0, layout)).toEqual({ x: -100, y: 0 });
    expect(clampOffset(120, 40, layout)).toEqual({ x: 100, y: 0 });
    expect(clampOffset(10, -5, layout)).toEqual({ x: 10, y: 0 });
  });
});

describe('cropRectangle', () => {
  it('a centred frame at the smallest zoom cuts the picture exactly in half', () => {
    const rect = cropRectangle({ ...WIDE, zoom: 1, offsetX: 0, offsetY: 0 });
    expect(rect.sx).toBe(100);
    expect(rect.sy).toBe(0);
    expect(rect.sWidth).toBe(200);
    expect(rect.sHeight).toBe(200);
  });

  it('a panned frame moves the cut with it, and clamps at the edge', () => {
    const panned = cropRectangle({ ...WIDE, zoom: 1, offsetX: 100, offsetY: 0 });
    expect(panned.sx).toBe(200);
    const over = cropRectangle({ ...WIDE, zoom: 1, offsetX: 500, offsetY: 0 });
    expect(over.sx).toBe(200);
  });

  it('a zoomed frame cuts a smaller source region', () => {
    const rect = cropRectangle({ ...WIDE, zoom: 2, offsetX: 0, offsetY: 0 });
    expect(rect.sWidth).toBe(100);
    expect(rect.sHeight).toBe(100);
  });
});
