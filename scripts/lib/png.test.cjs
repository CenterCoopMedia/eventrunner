'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const { PngError, encodePng, decodePng, resizeSquare } = require('./png.cjs');

// Every fixture is built here, byte by byte, by a small encoder that is
// independent of the one under test: its own chunk writer, its own filters.
// Real encoders split IDAT and add ancillary chunks, so the builder can too.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(payload.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}

function header({ width, height, bitDepth = 8, colorType, compression = 0, filterMethod = 0, interlace = 0 }) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.set([bitDepth, colorType, compression, filterMethod, interlace], 8);
  return data;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Filter one packed row the way an encoder does. */
function filterRow(type, row, previous, bpp) {
  const out = Buffer.alloc(row.length + 1);
  out[0] = type;
  for (let i = 0; i < row.length; i += 1) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = previous ? previous[i] : 0;
    const c = i >= bpp && previous ? previous[i - bpp] : 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
    out[i + 1] = (row[i] - predictor) & 0xff;
  }
  return out;
}

/**
 * A PNG from packed rows. `filters` picks each row's filter (cycled);
 * `before` and `after` are extra [type, payload] chunks around the image
 * data; `split` cuts the compressed data into that many IDAT chunks.
 */
function buildPng({
  width, height, colorType, bitDepth = 8, rows, bpp, filters = [0], before = [], after = [], split = 1,
  headerFields = {}, raw = null,
}) {
  const scanlines = raw ?? Buffer.concat(rows.map((row, y) => (
    filterRow(filters[y % filters.length], row, y > 0 ? rows[y - 1] : null, bpp)
  )));
  const compressed = zlib.deflateSync(scanlines);
  const step = Math.ceil(compressed.length / split);
  const idat = [];
  for (let at = 0; at < compressed.length; at += step) idat.push(chunk('IDAT', compressed.subarray(at, at + step)));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header({ width, height, bitDepth, colorType, ...headerFields })),
    ...before.map(([type, payload]) => chunk(type, payload)),
    ...idat,
    ...after.map(([type, payload]) => chunk(type, payload)),
    chunk('IEND'),
  ]);
}

/** A deterministic RGBA test card with varied colour and alpha. */
function testCard(width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba.set([(i * 37) & 0xff, (i * 91 + 17) & 0xff, (i * 13 + 200) & 0xff, (i * 53 + 90) & 0xff], i * 4);
  }
  return rgba;
}

/** RGBA rows of a test card, packed for colour type 6. */
function rgbaRows(width, height) {
  const rgba = testCard(width, height);
  return { rgba, rows: Array.from({ length: height }, (_, y) => rgba.subarray(y * width * 4, (y + 1) * width * 4)) };
}

/** Assert a PngError with the given reason. */
function refuses(bytes, reason, options) {
  assert.throws(() => decodePng(bytes, options), (err) => err instanceof PngError && err.reason === reason);
}

/** The chunk types in a PNG, in order. */
function chunkTypes(bytes) {
  const types = [];
  for (let at = 8; at < bytes.length; at += bytes.readUInt32BE(at) + 12) {
    types.push(bytes.toString('latin1', at + 4, at + 8));
  }
  return types;
}

const PLAIN = rgbaRows(7, 5);
const PLAIN_PNG = buildPng({ width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4 });

// --- encode ------------------------------------------------------------------

test('encode then decode returns the same pixels', () => {
  const rgba = testCard(9, 6);
  const image = decodePng(encodePng({ width: 9, height: 6, rgba }));
  assert.equal(image.width, 9);
  assert.equal(image.height, 6);
  assert.ok(image.rgba.equals(rgba));
});

test('the encoder writes only IHDR, IDAT, and IEND', () => {
  assert.deepEqual(chunkTypes(encodePng({ width: 2, height: 2, rgba: testCard(2, 2) })), ['IHDR', 'IDAT', 'IEND']);
});

test('the encoder refuses pixels that do not fill the image', () => {
  assert.throws(() => encodePng({ width: 2, height: 2, rgba: Buffer.alloc(15) }), RangeError);
  assert.throws(() => encodePng({ width: 0, height: 2, rgba: Buffer.alloc(0) }), RangeError);
});

// --- decode: filters and colour types -----------------------------------------

test('the plain fixture decodes to its own pixels', () => {
  assert.ok(decodePng(PLAIN_PNG).rgba.equals(PLAIN.rgba));
});

for (const filter of [1, 2, 3, 4]) {
  test(`filter type ${filter} decodes`, () => {
    const bytes = buildPng({ width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, filters: [filter] });
    assert.ok(decodePng(bytes).rgba.equals(PLAIN.rgba));
  });
}

test('rows with mixed filters decode', () => {
  const bytes = buildPng({ width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, filters: [4, 0, 3, 1, 2] });
  assert.ok(decodePng(bytes).rgba.equals(PLAIN.rgba));
});

test('gray decodes to equal channels, opaque', () => {
  const bytes = buildPng({ width: 3, height: 1, colorType: 0, rows: [Buffer.from([0, 128, 255])], bpp: 1 });
  assert.deepEqual([...decodePng(bytes).rgba], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
});

test('gray with tRNS makes the named gray transparent', () => {
  const bytes = buildPng({
    width: 2, height: 1, colorType: 0, rows: [Buffer.from([7, 8])], bpp: 1, before: [['tRNS', Buffer.from([0, 7])]],
  });
  assert.deepEqual([...decodePng(bytes).rgba], [7, 7, 7, 0, 8, 8, 8, 255]);
});

test('gray plus alpha decodes', () => {
  const bytes = buildPng({ width: 2, height: 1, colorType: 4, rows: [Buffer.from([10, 20, 30, 40])], bpp: 2, filters: [1] });
  assert.deepEqual([...decodePng(bytes).rgba], [10, 10, 10, 20, 30, 30, 30, 40]);
});

test('RGB decodes opaque', () => {
  const bytes = buildPng({ width: 2, height: 1, colorType: 2, rows: [Buffer.from([1, 2, 3, 4, 5, 6])], bpp: 3, filters: [4] });
  assert.deepEqual([...decodePng(bytes).rgba], [1, 2, 3, 255, 4, 5, 6, 255]);
});

test('RGB with tRNS makes the named colour transparent', () => {
  const bytes = buildPng({
    width: 2, height: 1, colorType: 2, rows: [Buffer.from([1, 2, 3, 1, 2, 4])], bpp: 3,
    before: [['tRNS', Buffer.from([0, 1, 0, 2, 0, 3])]],
  });
  assert.deepEqual([...decodePng(bytes).rgba], [1, 2, 3, 0, 1, 2, 4, 255]);
});

test('a tRNS chunk on an image with its own alpha is ignored', () => {
  const bytes = buildPng({
    width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, before: [['tRNS', Buffer.from([0, 0])]],
  });
  assert.ok(decodePng(bytes).rgba.equals(PLAIN.rgba));
});

const PALETTE = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);

test('an 8-bit palette with a shorter tRNS decodes, the rest opaque', () => {
  const bytes = buildPng({
    width: 4, height: 1, colorType: 3, rows: [Buffer.from([0, 1, 2, 3])], bpp: 1,
    before: [['PLTE', PALETTE], ['tRNS', Buffer.from([0, 128])]],
  });
  assert.deepEqual([...decodePng(bytes).rgba], [
    10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255, 100, 110, 120, 255,
  ]);
});

test('a 4-bit palette unpacks two pixels a byte, high nibble first', () => {
  // Three pixels: indices 1, 3, 2, the last byte half used.
  const bytes = buildPng({
    width: 3, height: 2, colorType: 3, bitDepth: 4, rows: [Buffer.from([0x13, 0x20]), Buffer.from([0x02, 0x10])],
    bpp: 1, filters: [0, 2], before: [['PLTE', PALETTE]],
  });
  const { rgba } = decodePng(bytes);
  const indices = [];
  for (let i = 0; i < 6; i += 1) indices.push(PALETTE.indexOf(rgba[i * 4]) / 3);
  assert.deepEqual(indices, [1, 3, 2, 0, 2, 1]);
});

test('2-bit and 1-bit palettes unpack from the high bits', () => {
  const two = buildPng({
    width: 5, height: 1, colorType: 3, bitDepth: 2, rows: [Buffer.from([0b00011011, 0b10000000])],
    bpp: 1, before: [['PLTE', PALETTE]],
  });
  assert.deepEqual([...decodePng(two).rgba].filter((_, i) => i % 4 === 0), [10, 40, 70, 100, 70]);
  const one = buildPng({
    width: 9, height: 1, colorType: 3, bitDepth: 1, rows: [Buffer.from([0b10110001, 0b10000000])],
    bpp: 1, filters: [1], before: [['PLTE', PALETTE.subarray(0, 6)]],
  });
  assert.deepEqual([...decodePng(one).rgba].filter((_, i) => i % 4 === 0), [40, 10, 40, 40, 10, 10, 10, 40, 40]);
});

// --- decode: what real exports carry -----------------------------------------

test('ancillary chunks and image data split across three IDAT chunks decode to the same pixels', () => {
  const bytes = buildPng({
    width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, split: 3,
    before: [
      ['sRGB', Buffer.from([0])],
      ['pHYs', Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1])],
      ['iCCP', Buffer.concat([Buffer.from('profile\0\0', 'latin1'), zlib.deflateSync(Buffer.alloc(40))])],
      ['tEXt', Buffer.from('Software\0test encoder', 'latin1')],
      ['eXIf', Buffer.from('MM\0*\0\0\0\x08\0\0', 'latin1')],
    ],
  });
  assert.equal(chunkTypes(bytes).filter((type) => type === 'IDAT').length, 3);
  assert.ok(decodePng(bytes).rgba.equals(PLAIN.rgba));
});

test('an animated PNG gives its default image', () => {
  const bytes = buildPng({
    width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4,
    before: [['acTL', Buffer.alloc(8)], ['fcTL', Buffer.alloc(26)]],
    after: [['fcTL', Buffer.alloc(26)], ['fdAT', Buffer.alloc(12)]],
  });
  assert.ok(decodePng(bytes).rgba.equals(PLAIN.rgba));
});

test('re-encoding a decoded image with an eXIf chunk drops the metadata', () => {
  const bytes = buildPng({
    width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4,
    before: [['eXIf', Buffer.from('MM\0*\0\0\0\x08\0\0', 'latin1')], ['tEXt', Buffer.from('GPS\0somewhere', 'latin1')]],
  });
  const again = encodePng(decodePng(bytes));
  assert.deepEqual(chunkTypes(again), ['IHDR', 'IDAT', 'IEND']);
  assert.ok(decodePng(again).rgba.equals(PLAIN.rgba));
});

// --- decode: refusals ----------------------------------------------------------

test('a file without the PNG signature is not a PNG', () => {
  refuses(Buffer.from('GIF89a, not a PNG at all'), 'not-png');
  refuses(SIGNATURE.subarray(0, 4), 'not-png');
  refuses('a string', 'not-png');
});

test('a chunk with a bad CRC is damaged', () => {
  const bytes = Buffer.from(PLAIN_PNG);
  bytes[8 + 8 + 2] ^= 0xff; // inside the IHDR payload
  refuses(bytes, 'damaged');
});

test('a file cut inside a chunk is damaged', () => {
  refuses(PLAIN_PNG.subarray(0, PLAIN_PNG.length - 20), 'damaged');
});

test('a file cut inside a chunk header is damaged', () => {
  // IEND is 12 bytes; keep 6 of them.
  refuses(PLAIN_PNG.subarray(0, PLAIN_PNG.length - 6), 'damaged');
});

test('a file with no IEND is damaged', () => {
  refuses(PLAIN_PNG.subarray(0, PLAIN_PNG.length - 12), 'damaged');
});

test('a file whose first chunk is not IHDR is damaged', () => {
  const bytes = Buffer.concat([SIGNATURE, chunk('tEXt', Buffer.from('a\0b', 'latin1')), PLAIN_PNG.subarray(8)]);
  refuses(bytes, 'damaged');
});

test('a second IHDR is damaged', () => {
  const bytes = buildPng({
    width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4,
    before: [['IHDR', header({ width: 7, height: 5, colorType: 6 })]],
  });
  refuses(bytes, 'damaged');
});

test('an IHDR of the wrong length is damaged', () => {
  const bytes = Buffer.concat([SIGNATURE, chunk('IHDR', Buffer.alloc(12)), chunk('IEND')]);
  refuses(bytes, 'damaged');
});

test('a side of zero is damaged', () => {
  refuses(buildPng({ width: 0, height: 5, colorType: 6, raw: Buffer.alloc(5) }), 'damaged');
});

test('an unknown compression or filter method is damaged', () => {
  const rows = { width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4 };
  refuses(buildPng({ ...rows, headerFields: { compression: 1 } }), 'damaged');
  refuses(buildPng({ ...rows, headerFields: { filterMethod: 1 } }), 'damaged');
});

test('a side over the limit is refused before any image data is inflated', () => {
  // The image data is not deflate data at all. Were it inflated, the
  // refusal would say damaged; the side check comes first.
  const bytes = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header({ width: 5000, height: 5000, colorType: 6 })),
    chunk('IDAT', Buffer.from('not deflate data')),
    chunk('IEND'),
  ]);
  refuses(bytes, 'too-large');
  refuses(PLAIN_PNG, 'too-large', { maxSide: 6 });
  assert.equal(decodePng(PLAIN_PNG, { maxSide: 7 }).width, 7);
});

test('16-bit and gray below 8 bits are unsupported', () => {
  refuses(buildPng({ width: 1, height: 1, colorType: 6, bitDepth: 16, raw: Buffer.alloc(9) }), 'unsupported');
  refuses(buildPng({ width: 2, height: 1, colorType: 0, bitDepth: 4, raw: Buffer.alloc(2) }), 'unsupported');
  refuses(buildPng({ width: 1, height: 1, colorType: 5, raw: Buffer.alloc(3) }), 'unsupported');
});

test('an interlaced image is unsupported', () => {
  refuses(buildPng({ width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, headerFields: { interlace: 1 } }), 'unsupported');
});

test('an unknown critical chunk is unsupported', () => {
  refuses(buildPng({ width: 7, height: 5, colorType: 6, rows: PLAIN.rows, bpp: 4, before: [['XYZW', Buffer.alloc(4)]] }), 'unsupported');
});

test('a palette image with no PLTE is unsupported', () => {
  refuses(buildPng({ width: 2, height: 1, colorType: 3, rows: [Buffer.from([0, 0])], bpp: 1 }), 'unsupported');
});

test('a PLTE of a bad length is damaged', () => {
  const image = { width: 2, height: 1, colorType: 3, rows: [Buffer.from([0, 0])], bpp: 1 };
  refuses(buildPng({ ...image, before: [['PLTE', Buffer.alloc(4)]] }), 'damaged');
  refuses(buildPng({ ...image, before: [['PLTE', Buffer.alloc(0)]] }), 'damaged');
  refuses(buildPng({ ...image, before: [['PLTE', Buffer.alloc(771)]] }), 'damaged');
});

test('a palette index past the palette is damaged', () => {
  refuses(buildPng({
    width: 2, height: 1, colorType: 3, rows: [Buffer.from([0, 4])], bpp: 1, before: [['PLTE', PALETTE]],
  }), 'damaged');
});

test('a gray or RGB tRNS that is too short is damaged', () => {
  refuses(buildPng({
    width: 2, height: 1, colorType: 0, rows: [Buffer.from([7, 8])], bpp: 1, before: [['tRNS', Buffer.from([7])]],
  }), 'damaged');
  refuses(buildPng({
    width: 1, height: 1, colorType: 2, rows: [Buffer.from([1, 2, 3])], bpp: 3, before: [['tRNS', Buffer.alloc(4)]],
  }), 'damaged');
});

test('a file with no IDAT is damaged', () => {
  const bytes = Buffer.concat([SIGNATURE, chunk('IHDR', header({ width: 1, height: 1, colorType: 6 })), chunk('IEND')]);
  refuses(bytes, 'damaged');
});

test('image data that inflates past the size IHDR implies is damaged', () => {
  // One row too many: a decompression bomb is the same case, larger.
  const extra = Buffer.concat([...PLAIN.rows, PLAIN.rows[0]].map((row) => filterRow(0, row, null, 4)));
  refuses(buildPng({ width: 7, height: 5, colorType: 6, raw: extra }), 'damaged');
});

test('image data that inflates short of the size IHDR implies is damaged', () => {
  const short = Buffer.concat(PLAIN.rows.slice(0, 4).map((row) => filterRow(0, row, null, 4)));
  refuses(buildPng({ width: 7, height: 5, colorType: 6, raw: short }), 'damaged');
});

test('image data that is not deflate data is damaged', () => {
  const bytes = Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header({ width: 1, height: 1, colorType: 6 })),
    chunk('IDAT', Buffer.from('not deflate data')),
    chunk('IEND'),
  ]);
  refuses(bytes, 'damaged');
});

test('an unknown filter type is damaged', () => {
  const raw = Buffer.concat(PLAIN.rows.map((row, y) => filterRow(0, row, y > 0 ? PLAIN.rows[y - 1] : null, 4)));
  raw[(7 * 4 + 1) * 2] = 5; // row 2's filter byte
  refuses(buildPng({ width: 7, height: 5, colorType: 6, raw }), 'damaged');
});

// --- resize --------------------------------------------------------------------

function solid(side, [r, g, b, a]) {
  const rgba = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i += 1) rgba.set([r, g, b, a], i * 4);
  return rgba;
}

test('a two-colour 1024 image halves exactly at 512', () => {
  const side = 1024;
  const rgba = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) rgba.set(x < 512 ? [200, 40, 10, 255] : [15, 90, 230, 255], (y * side + x) * 4);
  }
  const out = resizeSquare({ side, rgba }, 512);
  assert.equal(out.width, 512);
  assert.equal(out.height, 512);
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const at = (y * 512 + x) * 4;
      assert.deepEqual([...out.rgba.subarray(at, at + 4)], x < 256 ? [200, 40, 10, 255] : [15, 90, 230, 255]);
    }
  }
});

test('transparent next to opaque white stays white, not grey', () => {
  // Columns alternate clear black and opaque white; every output pixel
  // covers one of each.
  const side = 4;
  const rgba = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i += 1) if (i % 2 === 1) rgba.set([255, 255, 255, 255], i * 4);
  const out = resizeSquare({ side, rgba }, 2);
  for (let i = 0; i < 4; i += 1) assert.deepEqual([...out.rgba.subarray(i * 4, i * 4 + 4)], [255, 255, 255, 128]);
});

test('a fully clear area stays clear black', () => {
  const out = resizeSquare({ side: 4, rgba: solid(4, [0, 0, 0, 0]) }, 2);
  assert.ok(out.rgba.equals(Buffer.alloc(16)));
});

test('a solid image stays the same colour at a fractional scale', () => {
  const out = resizeSquare({ side: 512, rgba: solid(512, [91, 93, 97, 255]) }, 192);
  assert.ok(out.rgba.equals(solid(192, [91, 93, 97, 255])));
});
