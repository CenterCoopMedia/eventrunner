// URL building and the upload pre-checks (issue #24 review follow-ups).
//
// The load-bearing decision pinned here: object URLs are BUILT, not fetched
// with getDownloadURL(). Admin-SDK writes — every cms-images and branding
// file, and the placeholders init seeds — carry no
// firebaseStorageDownloadTokens, so getDownloadURL rejects for exactly the
// files the library exists to show. The token-free media URL is served
// subject to storage.rules instead.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  storageBucketName: 'demo-run-of-show.appspot.com',
  storageDownloadOrigin: 'https://firebasestorage.googleapis.com',
  appCheckEnabled: false,
  appCheckHeaders: vi.fn(async () => ({})),
}));

const {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  assetSrcSet,
  assetUrl,
  brandingSrc,
  checkFile,
  formatBytes,
  imageBlockSources,
  storagePath,
} = await import('./mediaSource.js');

const BUCKET = 'demo-run-of-show.appspot.com';

describe('assetUrl', () => {
  it('serves furnished demo images without a Storage URL in normal mode', () => {
    expect(assetUrl('demo/speakers/marisol-reyes.webp')).toBe('/demo/speakers/marisol-reyes.webp');
    expect(assetUrl('demo/sponsors/beacon-community-fund.webp')).toBe('/demo/sponsors/beacon-community-fund.webp');
    expect(assetUrl('branding/demo-venue-plan.svg')).toBe('/branding/demo-venue-plan.svg');
  });

  it('builds the token-free media URL for an object path', () => {
    expect(assetUrl('cms-images/asset-1/hero.png')).toBe(
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/` +
        `${encodeURIComponent('cms-images/asset-1/hero.png')}?alt=media`,
    );
  });

  it('percent-encodes the path so slashes address one object, not a folder', () => {
    expect(assetUrl('branding/a b/logo (1).png')).toContain(
      encodeURIComponent('branding/a b/logo (1).png'),
    );
  });

  it('refuses values that are not usable object paths', () => {
    for (const value of [
      null,
      42,
      '',
      '   ',
      '/cms-images/a/b.png',
      '../secrets/key.png',
      'https://evil.example/x.png',
      'javascript:alert(1)',
    ]) {
      expect(assetUrl(value)).toBeNull();
    }
  });
});

// Issue #333: the function writes display sizes beside an upload, and the
// page offers them through srcset. The original stays the src.
describe('assetSrcSet', () => {
  const sizeUrl = (path) =>
    `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(path)}?alt=media`;

  it('lists the WebP sizes beside an uploaded headshot, widest last', () => {
    expect(assetSrcSet('speaker-photos/spk-1/a1b2c3/face.jpg')).toBe(
      [320, 640, 1280, 1920]
        .map((width) => `${sizeUrl(`speaker-photos/spk-1/a1b2c3/_sizes/${width}.webp`)} ${width}w`)
        .join(', '),
    );
  });

  it('lists sizes for library uploads too', () => {
    expect(assetSrcSet('cms-images/a1b2c3/hero.png')).toContain(
      encodeURIComponent('cms-images/a1b2c3/_sizes/640.webp'),
    );
    expect(assetSrcSet('branding/a1b2c3/logo.webp')).toContain(' 1920w');
  });

  it('offers no sizes where the function writes none', () => {
    for (const path of [
      null,
      'branding/logo.svg',
      'branding/logo.png',
      'cms-images/a1b2c3/logo.svg',
      'cms-images/a1b2c3/loop.gif',
      'profile-photos/uid-1/photo.jpg',
      'speaker-photos/spk-1/photo.jpg',
      'demo/speakers/marisol-reyes.webp',
      'default-avatars/avatar-01.svg',
      'https://example.org/x.jpg',
    ]) {
      expect(assetSrcSet(path)).toBeNull();
    }
  });
});

describe('imageBlockSources', () => {
  it('resolves a picked library path to the bucket, with sizes', () => {
    // The image block stores the object path the picker chose. As a bare
    // relative src it named a page on the site, not the object.
    const { src, srcSet } = imageBlockSources('cms-images/a1b2c3/hero.jpg');
    expect(src).toBe(assetUrl('cms-images/a1b2c3/hero.jpg'));
    expect(srcSet).toBe(assetSrcSet('cms-images/a1b2c3/hero.jpg'));
  });

  it('resolves a library GIF to the bucket, without sizes', () => {
    expect(imageBlockSources('cms-images/a1b2c3/loop.gif')).toEqual({
      src: assetUrl('cms-images/a1b2c3/loop.gif'),
      srcSet: null,
    });
  });

  it('leaves a link, a site path, and a seeded flat path as they were', () => {
    for (const url of ['https://example.org/hall.jpg', '/hero/newsroom.webp', 'branding/logo.svg']) {
      expect(imageBlockSources(url)).toEqual({ src: url, srcSet: null });
    }
  });
});

describe('storagePath', () => {
  it('trims and accepts a plain relative path', () => {
    expect(storagePath('  cms-images/a/b.png ')).toBe('cms-images/a/b.png');
  });
});

describe('brandingSrc', () => {
  it('serves a seeded flat path from the bundle', () => {
    // branding/logo.svg ships in apps/web/public/branding/ AND is uploaded by
    // init; the bundled copy renders before Storage is even provisioned.
    expect(brandingSrc('branding/logo.svg')).toBe('/branding/logo.svg');
  });

  it('serves an uploaded asset from Storage, not Hosting', () => {
    // The bug this fixes: a picker-stored path exists only in the bucket, so
    // the Hosting-relative form 404s the header logo.
    expect(brandingSrc('branding/abc123/logo.png')).toContain('firebasestorage.googleapis.com');
    expect(brandingSrc('branding/abc123/logo.png')).toContain(
      encodeURIComponent('branding/abc123/logo.png'),
    );
  });

  it('resolves an unusable value to null so the caller renders nothing', () => {
    expect(brandingSrc({ toString: () => 'branding/x.svg' })).toBeNull();
    expect(brandingSrc('')).toBeNull();
    expect(brandingSrc('/branding/logo.svg')).toBeNull();
  });
});

describe('checkFile', () => {
  const png = (size) => {
    const file = new File([''], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  it('refuses a file of exactly the profile-photo cap, matching the strict rule', () => {
    // storage.rules: request.resource.size < 2 * 1024 * 1024.
    const limits = {
      types: PROFILE_PHOTO_TYPES,
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      exclusive: true,
    };
    expect(checkFile(png(PROFILE_PHOTO_MAX_BYTES), limits)).toMatch(/under 2\.0 MB/);
    expect(checkFile(png(PROFILE_PHOTO_MAX_BYTES - 1), limits)).toBeNull();
  });

  it('allows exactly the cap where the server bound is inclusive', () => {
    // functions/src/media/upload.cjs rejects on `size > MAX_UPLOAD_BYTES`.
    expect(checkFile(png(1000), { types: ['image/png'], maxBytes: 1000 })).toBeNull();
    expect(checkFile(png(1001), { types: ['image/png'], maxBytes: 1000 })).toMatch(/limit is/);
  });

  it('names the offending type', () => {
    const pdf = new File([''], 'a.pdf', { type: 'application/pdf' });
    expect(checkFile(pdf, { types: PROFILE_PHOTO_TYPES, maxBytes: 10 })).toMatch(/application\/pdf/);
  });
});

describe('formatBytes', () => {
  it('reads as a size a person recognizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
