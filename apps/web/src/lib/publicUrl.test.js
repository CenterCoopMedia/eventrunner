import { describe, expect, it } from 'vitest';
import { publicUrl } from './publicUrl.js';

describe('public route URLs', () => {
  it('uses the requested public path without preview, filters or fragment state', () => {
    expect(publicUrl('/schedule/room%20one?preview=1&day=two#notes', { origin: 'https://event.example', base: '/', demo: false }))
      .toBe('https://event.example/schedule/room%20one');
  });

  it('keeps the configured app prefix in one place', () => {
    expect(publicUrl('/speakers/rae', { origin: 'https://event.example', base: '/camp/', demo: false }))
      .toBe('https://event.example/camp/speakers/rae');
  });

  it('builds reloadable hash routes for the static demo', () => {
    expect(publicUrl('/updates/one?preview=1', { origin: 'https://demo.example', base: '/eventrunner/demo/', demo: true }))
      .toBe('https://demo.example/eventrunner/demo/#/updates/one');
  });
});
