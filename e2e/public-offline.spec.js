import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import offlinePublic from '../scripts/lib/offline-public.cjs';

const mount = '/agenda/';
const generation = '2026-11-22T14:00:00.000Z';

function revision(directory, label) {
  const script = `assets/program-${label}.js`;
  const shell = '<!doctype html><html><head><title>Public program</title></head>'
    + `<body><p>Program ${label}</p><output></output><script src="${mount}${script}"></script></body></html>`;
  mkdirSync(path.join(directory, '.vite'), { recursive: true });
  mkdirSync(path.join(directory, 'assets'), { recursive: true });
  writeFileSync(path.join(directory, 'app-shell.html'), shell);
  writeFileSync(path.join(directory, script), `document.querySelector('output').textContent = 'Chunk ${label}';`);
  writeFileSync(path.join(directory, '.vite/offline-public.json'), JSON.stringify({
    project: 'offline-browser-fixture', base: mount, routes: ['/', '/schedule'],
    generatedAt: generation, files: ['app-shell.html', script],
  }));
  offlinePublic.writeOfflinePublic(directory);
  return new Map([
    ['app-shell.html', [shell, 'text/html']],
    ['schedule', [shell, 'text/html']],
    ['sw.js', [readFileSync(path.join(directory, 'sw.js')), 'text/javascript']],
    [script, [readFileSync(path.join(directory, script)), 'text/javascript']],
    ['offline-policy.json', [JSON.stringify({ enabled: true }), 'application/json']],
  ]);
}

test('a failed service-worker install leaves the saved shell usable until an explicit update', async ({ page, context }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'event-offline-browser-'));
  let active = revision(directory, 'one');
  let unavailable;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname.startsWith(mount) && pathname.slice(mount.length);
    const resource = active.get(file || '');
    if (!resource || file === unavailable) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': resource[1], 'Cache-Control': 'no-store' }).end(resource[0]);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const schedule = `http://127.0.0.1:${server.address().port}${mount}schedule?lang=es#program`;
  const update = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const outcome = new Promise((resolve) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing.addEventListener('statechange', () => {
          if (['installed', 'redundant'].includes(installing.state)) resolve(installing.state);
        });
      }, { once: true });
    });
    // A failed asynchronous install can reject update() before the waiting
    // worker exists. The installing worker's terminal state is the proof.
    await registration.update().catch(() => {});
    return outcome;
  });

  try {
    await page.goto(schedule);
    await page.evaluate(async (scope) => {
      await navigator.serviceWorker.register(`${scope}sw.js`, { scope, updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    }, mount);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('output')).toHaveText('Chunk one');
    await expect(page).toHaveURL(schedule);
    const first = await page.locator('meta[name="eventrunner-saved-build"]').getAttribute('content');
    expect(first).toContain(generation);

    await context.setOffline(false);
    active = revision(directory, 'two');
    unavailable = 'assets/program-two.js';
    expect(await update()).toBe('redundant');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('output')).toHaveText('Chunk one');
    await expect(page.locator('meta[name="eventrunner-saved-build"]')).toHaveAttribute('content', first);

    active = revision(directory, 'two');
    unavailable = null;
    await context.setOffline(false);
    expect(await update()).toBe('installed');
    await expect(page.locator('output')).toHaveText('Chunk one');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const controlled = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      registration.waiting.postMessage({ type: 'public-offline-use-update' });
      await controlled;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('output')).toHaveText('Chunk two');
    await expect(page).toHaveURL(schedule);
  } finally {
    await context.setOffline(false);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
