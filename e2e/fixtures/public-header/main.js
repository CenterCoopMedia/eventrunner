import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { quietActionClass } from '../../../apps/web/src/components/controlClasses.js';
import '../../../apps/web/src/generated/theme.css';

const params = new URLSearchParams(globalThis.location.search);
const before = params.get('source') === 'before' ? '?header-before' : '';
await import(/* @vite-ignore */ `/@fs${globalThis.HEADER_SOURCE}/index.css${before}`);
const { default: Header } = await import(/* @vite-ignore */ `/@fs${globalThis.HEADER_SOURCE}/components/Header.jsx${before}`);
const variant = params.get('variant');
const shape = params.get('logo');
const phone = globalThis.matchMedia('(max-width: 639px)').matches;
const svg = shape === 'wide'
  ? '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48"><rect width="240" height="48" fill="rgb(21,94,117)"/><text x="12" y="33" font-size="28" fill="white">News gathering</text></svg>'
  : '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="rgb(21,94,117)"/><text x="7" y="33" font-size="26" fill="white">NG</text></svg>';
const name = '2027 NC News & Information Summit';
const mark = shape === 'none' ? null : h('img', {
  alt: '', src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
  className: `site-logo${variant === 'masthead' ? ' site-logo--masthead' : ''}`,
});

createRoot(globalThis.document.getElementById('root')).render(
  h(MemoryRouter, null,
    h('header', { className: 'bg-surface' }, h('div', { className: 'stage' },
      h(Header, { variant, name, dates: 'March 12, 2027', place: 'Raleigh, NC', mark,
        mobileControl: h('button', { type: 'button', className: `site-header-menu no-print ${quietActionClass}`, 'data-mobile-visible': phone },
          'Menu', h('svg', { 'aria-hidden': 'true', viewBox: '0 0 16 16', width: 16, height: 16, className: 'disclosure-chevron' },
            h('path', { d: 'm4 6 4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))) },
      h('nav', { className: 'site-header-nav', 'aria-label': 'Main', 'data-placement': 'top', 'data-mobile-hidden': phone },
        h('ul', null, h('li', null, h('a', { href: '/schedule' }, 'Schedule')),
          h('li', null, h('a', { href: '/speakers' }, 'Speakers'))))))),
    h('main', { className: 'stage' }, h('h1', null, name), h('p', null, 'Shared public header fixture.'))),
);
