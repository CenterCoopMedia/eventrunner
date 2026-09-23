'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  APP_ICON_SIZES,
  PLACEHOLDER_DIR,
  PLACEHOLDER_MARK,
  REASONS,
  appIconPath,
  renderPlaceholderIcon,
  readPlaceholderIcons,
  markObjectUrl,
  iconsFromMark,
  resolveAppIcons,
  writeAppIcons,
} = require('./app-icons.cjs');
const { decodePng, encodePng } = require('./png.cjs');
const { defaultTheme } = require('./theme.cjs');

const BUCKET = 'demo-run-of-show.appspot.com';
const UPLOADED = 'branding/a1b2c3/square-icon.png';
const quiet = { log() {}, error() {} };

/** A square test mark: left half one colour, right half another. */
function twoColourMark(side, left = [200, 40, 10, 255], right = [15, 90, 230, 255]) {
  const rgba = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) rgba.set(x < side / 2 ? left : right, (y * side + x) * 4);
  }
  return encodePng({ width: side, height: side, rgba });
}

function pixel({ width, rgba }, x, y) {
  const at = (y * width + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

/** A fetch double that records its calls and answers with `respond`. */
function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, impl };
}

const neverFetch = () => { throw new Error('fetch must not be called'); };
const committed = () => readPlaceholderIcons();

// --- the placeholder -------------------------------------------------------------

for (const size of APP_ICON_SIZES) {
  test(`the ${size} placeholder fills the square and keeps the mark inside the maskable safe zone`, () => {
    const image = renderPlaceholderIcon(size);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    const ground = [...PLACEHOLDER_MARK.ground, 255];
    const ink = [...PLACEHOLDER_MARK.ink, 255];
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      assert.deepEqual(pixel(image, x, y), ground, `corner ${x},${y}`);
    }
    assert.deepEqual(pixel(image, size / 2, size / 2), ink);
    // Every pixel that is not plain ground lies within 40% of the side from
    // the centre, the circle a maskable icon's launcher mask always keeps.
    const safe = 0.4 * size;
    let marked = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const value = pixel(image, x, y);
        assert.equal(value[3], 255);
        if (value.every((v, i) => v === ground[i])) continue;
        marked += 1;
        const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
        assert.ok(distance <= safe, `pixel ${x},${y} is ${distance.toFixed(1)} from the centre`);
      }
    }
    assert.ok(marked > 0);
  });
}

test('the committed placeholder icons match a fresh render, pixel for pixel', () => {
  // Stale after a drawing change? Run `node scripts/dev/build-app-icons.mjs`
  // and commit both files.
  for (const file of committed()) {
    const size = Number(/app-icon-(\d+)\.png$/.exec(file.path)[1]);
    const decoded = decodePng(file.bytes);
    assert.equal(decoded.width, size);
    assert.equal(decoded.height, size);
    assert.ok(decoded.rgba.equals(renderPlaceholderIcon(size).rgba), `${file.path} is stale`);
  }
});

test('the default mark still holds the numbers the placeholder is drawn from', () => {
  // Failing after a change to mark.svg? Update PLACEHOLDER_MARK in
  // app-icons.cjs to match it, run `node scripts/dev/build-app-icons.mjs`,
  // and commit both PNGs. The script alone does not clear this test.
  const svg = fs.readFileSync(path.join(PLACEHOLDER_DIR, 'mark.svg'), 'utf8');
  const { grid, ground, ink, ring, dot } = PLACEHOLDER_MARK;
  const rgb = (color) => `rgb(${color.join(' ')})`;
  assert.match(svg, new RegExp(`viewBox="0 0 ${grid} ${grid}"`));
  assert.ok(svg.includes(`fill="${rgb(ground)}"`), 'the ground colour');
  assert.ok(
    svg.includes(`r="${ring.radius}" fill="none" stroke="${rgb(ink)}" stroke-width="${ring.width}"`),
    'the ring',
  );
  assert.ok(svg.includes(`r="${dot.radius}" fill="${rgb(ink)}"`), 'the dot');
});

test('icon paths are manifest-relative and sit in the branding folder', () => {
  assert.deepEqual([...APP_ICON_SIZES], [192, 512]);
  assert.deepEqual(APP_ICON_SIZES.map(appIconPath), ['branding/app-icon-192.png', 'branding/app-icon-512.png']);
});

// --- markObjectUrl -----------------------------------------------------------------

test('only an uploaded PNG in the branding folder gets a download URL', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/demo-run-of-show.appspot.com/o/'
    + 'branding%2Fa1b2c3%2Fsquare-icon.png?alt=media';
  assert.deepEqual(markObjectUrl({ mark: UPLOADED, bucket: BUCKET }), { url });
  assert.deepEqual(markObjectUrl({ mark: `  ${UPLOADED}  `, bucket: ` ${BUCKET} ` }), { url });
  assert.deepEqual(
    markObjectUrl({ mark: 'branding/a1b2c3/Square Icon.PNG', bucket: BUCKET }),
    { url: 'https://firebasestorage.googleapis.com/v0/b/demo-run-of-show.appspot.com/o/'
      + 'branding%2Fa1b2c3%2FSquare%20Icon.PNG?alt=media' },
  );
});

test('an empty slot or a seeded placeholder never reaches the bucket', () => {
  for (const mark of [undefined, null, '', '   ', 'branding/mark.svg', 'branding/logo.svg', 42]) {
    assert.deepEqual(markObjectUrl({ mark, bucket: BUCKET }), { reason: REASONS.placeholder }, String(mark));
  }
});

test('a path that is not an upload in the branding folder is refused with its reason', () => {
  for (const mark of [
    'branding/icon.png', // flat: a bundled file, not an upload
    'cms-images/a1b2c3/icon.png',
    '/branding/a1b2c3/icon.png',
    'branding/../cms-images/a1b2c3/icon.png',
    'https://elsewhere.example/branding/a1b2c3/icon.png',
    'gs://bucket/branding/a1b2c3/icon.png',
    'branding/a1b2c3/icon.gif',
  ]) {
    assert.deepEqual(markObjectUrl({ mark, bucket: BUCKET }), { reason: REASONS.notUploaded }, mark);
  }
});

test('an uploaded SVG, JPEG, or WebP is named as the wrong format', () => {
  for (const mark of ['branding/a/icon.svg', 'branding/a/icon.jpg', 'branding/a/icon.JPEG', 'branding/a/icon.webp']) {
    assert.deepEqual(markObjectUrl({ mark, bucket: BUCKET }), { reason: REASONS.notPng }, mark);
  }
  assert.match(REASONS.notPng, /app icons need a PNG/);
});

test('an uploaded PNG with no bucket says so', () => {
  for (const bucket of [undefined, '', '  ', true]) {
    assert.deepEqual(markObjectUrl({ mark: UPLOADED, bucket }), { reason: REASONS.noBucket });
  }
});

// --- iconsFromMark -------------------------------------------------------------------

test('an uploaded mark gives both sizes, resampled', () => {
  const files = iconsFromMark(twoColourMark(1024));
  assert.deepEqual(files.map((file) => file.path), APP_ICON_SIZES.map(appIconPath));
  for (const file of files) {
    const size = Number(/(\d+)\.png$/.exec(file.path)[1]);
    const image = decodePng(file.bytes);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.deepEqual(pixel(image, 0, 0), [200, 40, 10, 255]);
    assert.deepEqual(pixel(image, size - 1, size - 1), [15, 90, 230, 255]);
  }
});

// --- resolveAppIcons -----------------------------------------------------------------

test('the seeded mark gives the committed placeholder icons, maskable, without a fetch', async () => {
  const icons = await resolveAppIcons({ theme: defaultTheme(), bucket: BUCKET, fetchImpl: neverFetch });
  assert.equal(icons.source, 'placeholder');
  assert.equal(icons.maskable, true);
  assert.equal(icons.reason, REASONS.placeholder);
  assert.deepEqual(icons.files, committed());
});

test('an empty theme gives the committed placeholder icons without a fetch', async () => {
  const icons = await resolveAppIcons({ theme: {}, bucket: BUCKET, fetchImpl: neverFetch });
  assert.equal(icons.maskable, true);
  assert.deepEqual(icons.files, committed());
  const none = await resolveAppIcons({ fetchImpl: neverFetch });
  assert.deepEqual(none.files, committed());
});

test('an uploaded square PNG becomes both icons, not maskable', async () => {
  const bytes = twoColourMark(1024);
  const fetch = fakeFetch(() => new Response(bytes, { status: 200 }));
  const icons = await resolveAppIcons({ theme: { logos: { mark: UPLOADED } }, bucket: BUCKET, fetchImpl: fetch.impl });
  assert.equal(icons.source, 'mark');
  assert.equal(icons.maskable, false);
  assert.equal(icons.reason, null);
  assert.equal(icons.mark, UPLOADED);
  assert.deepEqual(icons.files.map((file) => decodePng(file.bytes).width), [192, 512]);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, markObjectUrl({ mark: UPLOADED, bucket: BUCKET }).url);
  assert.equal(fetch.calls[0].init.redirect, 'error');
  assert.ok(fetch.calls[0].init.signal instanceof AbortSignal);
});

/** Resolve with an uploaded mark and one fetch answer; expect the placeholder. */
async function placeholderFor(respond, options = {}) {
  const icons = await resolveAppIcons({
    theme: { logos: { mark: UPLOADED } }, bucket: BUCKET, fetchImpl: fakeFetch(respond).impl, ...options,
  });
  assert.equal(icons.source, 'placeholder');
  assert.equal(icons.maskable, true);
  assert.deepEqual(icons.files, committed());
  return icons.reason;
}

test('a fetch that fails gives the placeholder and names the failure', async () => {
  const reason = await placeholderFor(() => {
    throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
  });
  assert.equal(reason, 'the square icon could not be downloaded (getaddrinfo ENOTFOUND)');
});

test('a fetch that does not answer in time gives the placeholder', async () => {
  const reason = await placeholderFor(
    (_url, init) => new Promise((_resolve, reject) => {
      // AbortSignal.timeout does not hold the event loop open; a real
      // pending request does. This timer stands in for that socket.
      const socket = setTimeout(() => {}, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(socket);
        reject(init.signal.reason);
      });
    }),
    { timeoutMs: 20 },
  );
  assert.equal(reason, 'the square icon could not be downloaded (no answer in 0.02 seconds)');
});

test('a 404 gives the placeholder and names the status', async () => {
  const reason = await placeholderFor(() => new Response('not found', { status: 404 }));
  assert.equal(reason, 'the square icon could not be downloaded (HTTP 404)');
});

test('a body over the byte cap stops the download and gives the placeholder', async () => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(400));
    },
  });
  const reason = await placeholderFor(() => new Response(body, { status: 200 }), { maxBytes: 1000 });
  assert.equal(reason, REASONS.tooManyBytes);
  assert.equal(reason, 'the square icon is larger than 5 MB');
  assert.ok(pulled <= 4, `read ${pulled} chunks of an endless body`);
});

test('an empty body is not a PNG', async () => {
  assert.equal(await placeholderFor(() => new Response(null, { status: 200 })), REASONS['not-png']);
});

test('a file that is not a PNG gives the placeholder', async () => {
  const reason = await placeholderFor(() => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200 }));
  assert.equal(reason, 'the square icon is not a PNG file');
});

test('a damaged PNG gives the placeholder', async () => {
  const bytes = twoColourMark(512);
  bytes[bytes.length - 20] ^= 0xff;
  assert.equal(await placeholderFor(() => new Response(bytes, { status: 200 })), 'the square icon file is damaged');
});

test('a PNG format the decoder does not read gives the placeholder', async () => {
  const bytes = Buffer.from(twoColourMark(512));
  bytes[8 + 8 + 12] = 1; // IHDR interlace byte
  bytes.writeUInt32BE(zlib.crc32(bytes.subarray(12, 29)) >>> 0, 29);
  assert.equal(
    await placeholderFor(() => new Response(bytes, { status: 200 })),
    'the square icon uses a PNG format this build cannot read',
  );
});

test('a non-square image gives the placeholder and names its size', async () => {
  const bytes = encodePng({ width: 600, height: 512, rgba: Buffer.alloc(600 * 512 * 4) });
  assert.equal(
    await placeholderFor(() => new Response(bytes, { status: 200 })),
    'the square icon is 600 by 512 pixels; it must be square',
  );
});

test('an image under 512 pixels gives the placeholder and names its width', async () => {
  assert.equal(
    await placeholderFor(() => new Response(twoColourMark(256), { status: 200 })),
    'the square icon is 256 pixels wide; it must be at least 512',
  );
});

/** A real PNG whose IHDR is rewritten to a size over the limit, CRC fixed. */
function oversized(width, height) {
  const bytes = Buffer.from(twoColourMark(512));
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(zlib.crc32(bytes.subarray(12, 29)) >>> 0, 29);
  return bytes;
}

test('an image over 4096 pixels gives the placeholder before it is inflated, and names both sides', async () => {
  assert.equal(
    await placeholderFor(() => new Response(oversized(5000, 5000), { status: 200 })),
    'the square icon is 5000 by 5000 pixels; each side must be 4096 or less',
  );
});

test('a tall image over the limit is named by both sides, not called wide', async () => {
  assert.equal(
    await placeholderFor(() => new Response(oversized(100, 5000), { status: 200 })),
    'the square icon is 100 by 5000 pixels; each side must be 4096 or less',
  );
});

test('a slot that is not an upload never calls fetch', async () => {
  for (const mark of ['branding/icon.png', 'cms-images/a/icon.png', 'branding/a/icon.svg', '']) {
    const icons = await resolveAppIcons({ theme: { logos: { mark } }, bucket: BUCKET, fetchImpl: neverFetch });
    assert.equal(icons.source, 'placeholder', mark);
  }
  const noBucket = await resolveAppIcons({ theme: { logos: { mark: UPLOADED } }, fetchImpl: neverFetch });
  assert.equal(noBucket.reason, REASONS.noBucket);
});

// --- writeAppIcons -------------------------------------------------------------------

test('writeAppIcons writes the placeholder icons and says why', async (t) => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-icons-'));
  t.after(() => fs.rmSync(distDir, { recursive: true, force: true }));
  const lines = [];
  const icons = await writeAppIcons({ distDir, theme: defaultTheme(), log: { log: (line) => lines.push(line) } });
  assert.equal(icons.maskable, true);
  for (const file of committed()) assert.ok(fs.readFileSync(path.join(distDir, file.path)).equals(file.bytes));
  assert.deepEqual(lines, [`app icons: neutral placeholder: ${REASONS.placeholder}`]);
});

test('writeAppIcons writes an uploaded mark and names the slot path', async (t) => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-icons-'));
  t.after(() => fs.rmSync(distDir, { recursive: true, force: true }));
  const lines = [];
  const bytes = twoColourMark(512);
  const icons = await writeAppIcons({
    distDir,
    theme: { logos: { mark: UPLOADED } },
    bucket: BUCKET,
    fetchImpl: async () => new Response(bytes, { status: 200 }),
    log: { log: (line) => lines.push(line) },
  });
  assert.equal(icons.maskable, false);
  for (const size of APP_ICON_SIZES) {
    assert.equal(decodePng(fs.readFileSync(path.join(distDir, appIconPath(size)))).width, size);
  }
  assert.deepEqual(lines, [`app icons: from the square icon slot (${UPLOADED})`]);
});

test('a placeholder directory without the icons is a write-path error, not a silent pass', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'app-icons-empty-'));
  try {
    await assert.rejects(writeAppIcons({ distDir: empty, theme: {}, placeholderDir: empty, log: quiet }), /ENOENT/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
