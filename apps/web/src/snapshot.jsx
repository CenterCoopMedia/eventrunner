import React from 'react';
import { Writable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { renderToPipeableStream } from 'react-dom/server';
import { Router, createPath } from 'react-router';
import AppRoot from './AppRoot.jsx';
import { theme } from '@generated/eventConfig.js';
import { resolveRootAttributes } from './lib/themeRuntime.js';
import { readDemoDisplay } from './components/DemoBanner.jsx';
import { ViewportProvider, WIDE_VIEWPORT } from './lib/viewport.js';

// Hash links must be identical to HashRouter's links at hydration.
const routeNavigator = { createHref: (to) => `#${typeof to === 'string' ? to : createPath(to)}` };

function renderRoute(route, viewport) {
  const view = { matchMedia: (query) => ({ matches:
    query === '(max-width: 639px)' ? viewport === 'compact'
      : query === WIDE_VIEWPORT && viewport === 'wide',
  }) };
  return new Promise((resolve, reject) => {
    const parts = [];
    const sink = new Writable({ write(chunk, encoding, done) { parts.push(chunk); done(); } });
    sink.on('finish', () => resolve(Buffer.concat(parts).toString('utf8')));
    sink.on('error', reject);
    const stream = renderToPipeableStream(
      <React.StrictMode>
        <Router location={route} navigator={routeNavigator} static>
          <ViewportProvider view={view}>
            <AppRoot />
          </ViewportProvider>
        </Router>
      </React.StrictMode>,
      {
        onAllReady() { stream.pipe(sink); },
        onShellError: reject,
        onError(error) { reject(error); stream.abort(); },
      },
    );
  });
}

export async function renderSnapshots() {
  const routes = [];
  for (const route of ['/', '/schedule', '/speakers']) {
    for (const viewport of ['compact', 'standard', 'wide']) {
      routes.push({ route, viewport, html: await renderRoute(route, viewport) });
    }
  }
  const attributes = resolveRootAttributes(theme);
  return {
    routes,
    display: readDemoDisplay('', theme),
    attributes: {
      'data-theme': attributes.theme,
      'data-motif-set': attributes.motifSet,
      'data-texture': theme.texture,
      'data-density': theme.density,
      'data-mode': theme.mode === 'dark' ? 'dark' : 'light',
    },
  };
}
