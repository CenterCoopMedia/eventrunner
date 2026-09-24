'use strict';

/**
 * A small PNG reader and writer for the app icons (#218). `node:zlib` only.
 *
 * Nothing in this repository's dependencies decodes or resamples an image
 * (scripts/dev/build-og-placeholder.mjs says the same about SVG), and the
 * site publisher image installs no browser. So the one raster path the app
 * icons need, an uploaded square PNG made smaller, is done here in plain
 * code.
 *
 * The reader takes untrusted bytes: an operator's upload, fetched from the
 * bucket at deploy time. It checks every chunk's length and CRC, refuses a
 * side above `maxSide` before it inflates anything, and inflates with a
 * ceiling of the exact size the header implies, so a small file cannot
 * expand into a large one. Every refusal is a `PngError` with a `reason`:
 *
 *   not-png      the signature is wrong
 *   damaged      a length, CRC, header field, or the image data is wrong
 *   unsupported  a PNG this reader does not read (16-bit, interlaced, gray
 *                below 8 bits, an unknown critical chunk, a palette image
 *                with no PLTE)
 *   too-large    a side is above `maxSide`; the error also carries the
 *                `width` and `height` IHDR names
 *
 * Every ancillary chunk (sRGB, gAMA, iCCP, pHYs, tEXt, eXIf, acTL, ...) is
 * skipped, so an APNG gives its default image and colour profiles are
 * ignored (sRGB is assumed). The writer emits IHDR, IDAT, and IEND only, so
 * no metadata from an upload reaches a re-encoded file.
 */

const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Samples per pixel, by colour type. */
const CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });

/** The bit depths this reader decodes, by colour type. */
const READABLE_DEPTHS = Object.freeze({
  0: Object.freeze([8]),
  2: Object.freeze([8]),
  3: Object.freeze([1, 2, 4, 8]),
  4: Object.freeze([8]),
  6: Object.freeze([8]),
});

class PngError extends Error {
  /**
   * @param {'not-png'|'damaged'|'unsupported'|'too-large'} reason
   * @param {string} message
   * @param {{ width?: number, height?: number }} [size] the IHDR size, when known
   */
  constructor(reason, message, size = {}) {
    super(message);
    this.name = 'PngError';
    this.reason = reason;
    this.width = size.width ?? null;
    this.height = size.height ?? null;
  }
}

const damaged = (message) => new PngError('damaged', message);
const unsupported = (message) => new PngError('unsupported', message);

/** One chunk: length, type, payload, CRC over type and payload. */
function chunk(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), payload])) >>> 0, 0);
  return Buffer.concat([head, payload, crc]);
}

/**
 * Encode 8-bit RGBA pixels as a PNG: colour type 6, filter 0 on every row,
 * deflate level 9.
 *
 * @param {{ width: number, height: number, rgba: Uint8Array }} image
 * @returns {Buffer}
 */
function encodePng({ width, height, rgba }) {
  const stride = width * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || rgba?.length !== stride * height) {
    throw new RangeError(`encodePng: ${width} by ${height} needs ${stride * height} RGBA bytes`);
  }
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Read and check IHDR. Throws before any image data is inflated. */
function readHeader(data, maxSide) {
  if (data.length !== 13) throw damaged('IHDR is not 13 bytes');
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const [bitDepth, colorType, compression, filterMethod, interlace] = data.subarray(8);
  if (width === 0 || height === 0) throw damaged('the image has a side of 0');
  if (compression !== 0 || filterMethod !== 0) throw damaged('unknown compression or filter method');
  if (width > maxSide || height > maxSide) {
    throw new PngError('too-large', `${width} by ${height} is above ${maxSide} pixels on a side`, { width, height });
  }
  if (!READABLE_DEPTHS[colorType]?.includes(bitDepth)) {
    throw unsupported(`colour type ${colorType} at ${bitDepth} bits`);
  }
  if (interlace !== 0) throw unsupported('interlaced');
  return { width, height, bitDepth, colorType };
}

/** The PNG predictor for one byte: a is left, b is up, c is up-left. */
function predict(filter, a, b, c) {
  switch (filter) {
    case 1: return a;
    case 2: return b;
    case 3: return (a + b) >> 1;
    case 4: {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      return pb <= pc ? b : c;
    }
    default: return 0;
  }
}

/** Undo the per-row filters. `bpp` is bytes per whole pixel, at least 1. */
function unfilter(data, { height, rowBytes, bpp }) {
  const out = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = data[y * (rowBytes + 1)];
    if (filter > 4) throw damaged(`unknown filter type ${filter} on row ${y}`);
    const src = y * (rowBytes + 1) + 1;
    const at = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= bpp ? out[at + x - bpp] : 0;
      const b = y > 0 ? out[at + x - rowBytes] : 0;
      const c = x >= bpp && y > 0 ? out[at + x - rowBytes - bpp] : 0;
      out[at + x] = (data[src + x] + predict(filter, a, b, c)) & 0xff;
    }
  }
  return out;
}

/** Unfiltered scanlines to 8-bit RGBA. */
function toRgba(pixels, { width, height, bitDepth, colorType, rowBytes }, palette, transparency) {
  const rgba = Buffer.alloc(width * height * 4);
  const channels = CHANNELS[colorType];
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const at = row + x * channels;
      if (colorType === 3) {
        const perByte = 8 / bitDepth;
        const shift = 8 - bitDepth * ((x % perByte) + 1);
        const index = (pixels[row + Math.floor(x / perByte)] >> shift) & ((1 << bitDepth) - 1);
        if (index * 3 >= palette.length) throw damaged(`palette index ${index} is out of range`);
        palette.copy(rgba, out, index * 3, index * 3 + 3);
        rgba[out + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const gray = pixels[at];
        rgba[out] = gray;
        rgba[out + 1] = gray;
        rgba[out + 2] = gray;
        if (colorType === 4) rgba[out + 3] = pixels[at + 1];
        else rgba[out + 3] = transparency && transparency.readUInt16BE(0) === gray ? 0 : 255;
      } else {
        pixels.copy(rgba, out, at, at + 3);
        if (colorType === 6) rgba[out + 3] = pixels[at + 3];
        else {
          const clear = transparency
            && transparency.readUInt16BE(0) === pixels[at]
            && transparency.readUInt16BE(2) === pixels[at + 1]
            && transparency.readUInt16BE(4) === pixels[at + 2];
          rgba[out + 3] = clear ? 0 : 255;
        }
      }
    }
  }
  return rgba;
}

/**
 * Decode a PNG to 8-bit RGBA.
 *
 * @param {Buffer} buffer
 * @param {{ maxSide?: number }} [options]
 * @returns {{ width: number, height: number, rgba: Buffer }}
 * @throws {PngError}
 */
function decodePng(buffer, { maxSide = 4096 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngError('not-png', 'the PNG signature is missing');
  }
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  let ended = false;
  let offset = 8;
  while (!ended && offset < buffer.length) {
    if (offset + 12 > buffer.length) throw damaged('a chunk runs past the end of the file');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) throw damaged(`the ${type} chunk runs past the end of the file`);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if ((zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length)) >>> 0) !== buffer.readUInt32BE(end - 4)) {
      throw damaged(`the ${type} chunk fails its CRC`);
    }
    offset = end;
    if ((header === null) !== (type === 'IHDR')) throw damaged('IHDR is not the first chunk, or appears twice');
    switch (type) {
      case 'IHDR': header = readHeader(data, maxSide); break;
      case 'PLTE':
        if (data.length === 0 || data.length % 3 !== 0 || data.length > 768) throw damaged('PLTE has a bad length');
        palette = data;
        break;
      case 'tRNS': transparency = data; break;
      case 'IDAT': idat.push(data); break;
      case 'IEND': ended = true; break;
      default:
        // Bit 5 of the first byte set (a lowercase letter) marks an
        // ancillary chunk, which a decoder may skip. A critical one it does
        // not know, it must not.
        if ((type.charCodeAt(0) & 0x20) === 0) throw unsupported(`unknown critical chunk ${type}`);
    }
  }
  if (!ended) throw damaged('the file has no IEND chunk');
  if (idat.length === 0) throw damaged('the file has no image data');
  if (header.colorType === 3 && palette === null) throw unsupported('a palette image with no PLTE chunk');
  // A gray or RGB tRNS names one 16-bit sample per channel. A palette tRNS
  // may be shorter than the palette; the rest stay opaque.
  const tRNSBytes = { 0: 2, 2: 6 }[header.colorType];
  if (transparency && transparency.length < tRNSBytes) throw damaged('tRNS is too short');

  const bitsPerPixel = CHANNELS[header.colorType] * header.bitDepth;
  const rowBytes = Math.ceil((header.width * bitsPerPixel) / 8);
  const expected = (rowBytes + 1) * header.height;
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch (err) {
    throw damaged(`the image data does not inflate to ${expected} bytes: ${err.message}`);
  }
  if (inflated.length !== expected) throw damaged(`the image data is ${inflated.length} bytes, not ${expected}`);

  const pixels = unfilter(inflated, { height: header.height, rowBytes, bpp: Math.max(1, bitsPerPixel >> 3) });
  const rgba = toRgba(pixels, { ...header, rowBytes }, palette, transparency);
  return { width: header.width, height: header.height, rgba };
}

/**
 * Resample a square RGBA image to `target` pixels on a side by area
 * averaging: each output pixel is the coverage-weighted mean of the source
 * pixels under it. Colour is averaged premultiplied by alpha, so a
 * transparent pixel next to an opaque one adds no colour of its own and a
 * light mark on a clear ground does not pick up a dark fringe.
 *
 * @param {{ side: number, rgba: Uint8Array }} image
 * @param {number} target
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
function resizeSquare({ side, rgba }, target) {
  const scale = side / target;
  // For each output index, the source indices under it and their weights,
  // which sum to 1. The same table serves both axes.
  const taps = [];
  for (let t = 0; t < target; t += 1) {
    const start = t * scale;
    const end = (t + 1) * scale;
    const row = [];
    for (let s = Math.floor(start); s < Math.min(side, Math.ceil(end)); s += 1) {
      row.push([s, (Math.min(end, s + 1) - Math.max(start, s)) / scale]);
    }
    taps.push(row);
  }

  // Pass 1: every source row to `target` columns, premultiplied.
  const across = new Float32Array(side * target * 4);
  for (let y = 0; y < side; y += 1) {
    for (let t = 0; t < target; t += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const [s, weight] of taps[t]) {
        const at = (y * side + s) * 4;
        const alpha = rgba[at + 3] * weight;
        r += rgba[at] * alpha;
        g += rgba[at + 1] * alpha;
        b += rgba[at + 2] * alpha;
        a += alpha;
      }
      const out = (y * target + t) * 4;
      across[out] = r; across[out + 1] = g; across[out + 2] = b; across[out + 3] = a;
    }
  }

  // Pass 2: `side` rows down to `target`, then back to straight alpha.
  const out = Buffer.alloc(target * target * 4);
  for (let t = 0; t < target; t += 1) {
    for (let x = 0; x < target; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (const [s, weight] of taps[t]) {
        const at = (s * target + x) * 4;
        r += across[at] * weight;
        g += across[at + 1] * weight;
        b += across[at + 2] * weight;
        a += across[at + 3] * weight;
      }
      const at = (t * target + x) * 4;
      if (a > 0) {
        out[at] = Math.min(255, Math.round(r / a));
        out[at + 1] = Math.min(255, Math.round(g / a));
        out[at + 2] = Math.min(255, Math.round(b / a));
      }
      out[at + 3] = Math.min(255, Math.round(a));
    }
  }
  return { width: target, height: target, rgba: out };
}

module.exports = { PngError, encodePng, decodePng, resizeSquare };
