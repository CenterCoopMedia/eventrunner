import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { resolveContentVariant } from 'shared/contentLanguages';

const { config, collections } = vi.hoisted(() => ({ config: new Map(), collections: new Map() }));
vi.mock('../lib/configSource.js', () => ({ subscribeConfigDoc: (id, next) => {
  config.set(id, next); return () => config.delete(id);
} }));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection: (name, _source, next) => { collections.set(name, next); return () => collections.delete(name); },
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('@generated/eventConfig.js', async (original) => {
  const data = await original();
  return { ...data, eventConfig: { ...data.eventConfig, contentLanguages: { default: 'es', available: ['en', 'es'] } } };
});
vi.mock('@generated/siteContent.js', () => ({ default: {
  hero__title: { section: 'hero', field: 'title', blockType: 'text', value: 'Welcome', visible: true,
    translations: { es: { value: 'Bienvenidos' } } },
} }));
vi.mock('@generated/pagesData.js', () => ({ default: [
  { id: 'visit', label: 'Visit', path: '/visit', sections: [], visible: true, translations: { es: { label: 'Visita' } } },
] }));
vi.mock('@generated/scheduleData.js', () => ({ default: [
  { id: 'talk', title: 'A talk', description: 'About the talk', visible: true,
    translations: { es: { title: 'Una charla', description: 'Sobre la charla' } } },
], speakers: [] }));

import { EventConfigProvider, useEventConfig } from './EventConfigContext.jsx';
import { ContentProvider, useContent } from './ContentContext.jsx';

function Probe() {
  const { eventConfig } = useEventConfig();
  const { getBlock, getPage, scheduleData } = useContent();
  const units = [['block', getBlock('hero', 'title')], ['page', getPage('visit')], ['session', scheduleData[0]]];
  return <>{units.map(([kind, record]) => {
    const result = resolveContentVariant(record, kind, 'es', eventConfig);
    return <output key={kind} data-testid={kind}>{JSON.stringify({ language: result.language,
      text: result.value?.value ?? result.value?.label ?? result.value?.title })}</output>;
  })}</>;
}

beforeEach(() => { config.clear(); collections.clear(); vi.stubGlobal('scrollTo', vi.fn()); });
afterEach(() => vi.unstubAllGlobals());

it('newer live records without Spanish replace older translated snapshots for every paired record kind', () => {
  render(<EventConfigProvider><ContentProvider pathname="/schedule" publicTools={false}><Probe /></ContentProvider></EventConfigProvider>);
  for (const kind of ['block', 'page', 'session']) expect(screen.getByTestId(kind).textContent).toContain('"language":"es"');
  act(() => {
    collections.get('cmsContent')([{ id: 'hero__title', section: 'hero', field: 'title', blockType: 'text', value: 'New welcome', visible: true }]);
    collections.get('cmsPages')([{ id: 'visit', label: 'New visit', path: '/visit', sections: [], visible: true }]);
    collections.get('cmsSchedule')([{ id: 'talk', title: 'New talk', description: 'New description', visible: true }]);
  });
  for (const kind of ['block', 'page', 'session']) expect(screen.getByTestId(kind).textContent).toContain('"language":"en"');
  expect(screen.getByTestId('block')).toHaveTextContent('New welcome');
  expect(screen.getByTestId('page')).toHaveTextContent('New visit');
  expect(screen.getByTestId('session')).toHaveTextContent('New talk');
});

it('a removed event locale is not revived by an older snapshot language configuration', () => {
  render(<EventConfigProvider><ContentProvider pathname="/schedule" publicTools={false}><Probe /></ContentProvider></EventConfigProvider>);
  expect(screen.getByTestId('block').textContent).toContain('"language":"es"');
  act(() => config.get('event')({ name: 'English event' }));
  for (const kind of ['block', 'page', 'session']) expect(screen.getByTestId(kind).textContent).toContain('"language":"en"');
});
