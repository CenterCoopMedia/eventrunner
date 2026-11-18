import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { adminDb } from './helpers.mjs';

const route = '/language-test';
const session = {
  title: 'Open data workshop', description: 'Bring a question about open data.',
  titleEs: 'Taller de datos abiertos', descriptionEs: 'Trae una pregunta sobre datos abiertos.',
  room: 'Cedar Room', id: 'language-partial', startTime: '13:15', endTime: '13:45',
};
const setting = { default: 'en', available: ['en', 'es'] };
const evidence = path.resolve('test-results/admin-visual-evidence');
let event;
let features;
let originalEvent;
let originalFeatures;
let bilingualEvent;
let fixtureRefs = [];
let completeRef;
let completeSession;
let draftRef;

test.use({ locale: 'es-MX' });

test.beforeAll(async () => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
    throw new Error('The language fixture requires the loopback Firestore emulator.');
  }
  const db = adminDb();
  event = db.doc('config/event');
  features = db.doc('config/features');
  [originalEvent, originalFeatures] = await Promise.all([event.get(), features.get()]);
  const days = originalEvent.get('days');
  const dayId = days[0].id;
  const create = (collection, id, data) => {
    const ref = db.collection(collection).doc(id);
    fixtureRefs.push(ref);
    batch.set(ref, { visible: true, ...data });
    return ref;
  };
  const batch = db.batch();
  bilingualEvent = {
    name: 'Example Language Event', historicalDemo: false, contentLanguages: setting, archivedAt: null,
    timezone: 'America/New_York', days: [{ ...days[0], date: '2099-10-15' }, ...days.slice(1)],
  };
  batch.set(event, bilingualEvent, { merge: true });
  batch.set(features, { schedule: true, icsExport: true }, { merge: true });
  create('cmsPages', 'language-test', {
    path: route, label: 'Language test', title: 'Event information',
    translations: { es: { label: 'Información', title: 'Información del evento' } },
    sections: [{
      id: 'language-links', label: 'Links', description: 'Editor guidance for placing links.',
      translations: { es: { label: 'Enlaces', description: 'Orientación para editar enlaces.' } },
    }],
  });
  const block = (field, blockType, order, data) => create('cmsContent', `language-links__${field}`,
    { section: 'language-links', field, blockType, order, ...data });
  const href = `${route}?topic=data#section-language-links`;
  block('cta', 'cta', 0, { label: 'Read the guide', url: href, translations: { es: { label: 'Leer la guía' } } });
  block('group', 'link_group', 1, { label: 'Another guide', url: href });
  block('rich', 'richtext', 2, {
    value: `<p><a href="${href}">Open the guide</a> <a href="https://example.org/?lang=en#external">External source</a> <a href="javascript:void(0)">Unsafe destination</a></p>`,
  });
  block('first', 'list_item', 3, { text: 'First note', translations: { es: { text: 'Primera nota' } } });
  block('second', 'list_item', 4, { text: 'Second note' });
  block('quote-first', 'quote', 5, { text: 'A map is a place to start.', translations: { es: { text: 'Un mapa es un punto de partida.' } } });
  block('quote-second', 'quote', 6, { text: 'Every street has a story.' });
  const baseSession = { dayId, type: 'Workshop', startTime: session.startTime, endTime: session.endTime, location: session.room };
  create('cmsSchedule', session.id, {
    ...baseSession, title: session.title, description: session.description, translations: { es: { title: session.titleEs } },
  });
  completeSession = {
    ...baseSession, visible: true, title: 'Map clinic', description: 'Bring a map.',
    translations: { es: { title: 'Clínica de mapas', description: 'Trae un mapa.' } },
  };
  completeRef = create('cmsSchedule', 'language-complete', completeSession);
  draftRef = create('cmsSchedule_drafts', session.id, {
    ...baseSession, title: 'Private translation draft', description: 'Unpublished copy.',
    translations: { es: { title: 'Borrador privado', description: 'Texto sin publicar.' } },
  });
  await batch.commit();
});

test.afterAll(async () => {
  if (!originalEvent || !originalFeatures) return;
  const batch = adminDb().batch();
  for (const ref of fixtureRefs) batch.delete(ref);
  for (const record of [originalEvent, originalFeatures]) {
    if (record.exists) batch.set(record.ref, record.data());
    else batch.delete(record.ref);
  }
  await batch.commit();
});

test('the browser preference yields to explicit URLs and history, with and without storage', async ({ page, browser, baseURL }) => {
  await page.goto(route);
  const root = page.locator('html');
  const english = page.getByRole('button', { name: 'English', exact: true });
  await expect(root).toHaveAttribute('lang', 'es');
  await expect(page).toHaveURL(/language-test\?lang=es$/);
  await page.goto(`${route}?lang=en`);
  await expect(root).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(english).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Read the guide' }).click();
  await expect(page).toHaveURL(/topic=data&lang=en#section-language-links$/);
  await page.goto('/schedule');
  await expect(page).toHaveURL(/schedule\?lang=en$/);
  await expect(root).toHaveAttribute('lang', 'en');

  const context = await browser.newContext({ locale: 'es-MX', baseURL });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(globalThis, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } });
    });
    const visitor = await context.newPage();
    await visitor.goto(`${route}?topic=data&lang=es#section-language-links`);
    const chooseEnglish = visitor.getByRole('button', { name: 'English', exact: true });
    await chooseEnglish.focus();
    await visitor.keyboard.press('Enter');
    await expect(chooseEnglish).toBeFocused();
    await expect(visitor).toHaveURL(/topic=data&lang=en#section-language-links$/);
    await visitor.goBack();
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'es');
    await visitor.goForward();
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'en');
    await visitor.getByRole('link', { name: 'Read the guide' }).click();
    await expect(visitor.locator('html')).toHaveAttribute('lang', 'en');
  } finally {
    await context.close();
  }
});

test('the hosted phone and desktop reader marks mixed language and retains keyboard focus', async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  for (const [size, width] of [['phone', 390], ['desktop', 1440]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${route}?lang=en`);
    const spanish = page.getByRole('button', { name: 'Español', exact: true });
    await expect(spanish).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(spanish).toBeFocused();
    await page.keyboard.press('Space');
    await expect(spanish).toBeFocused();
    await expect(spanish).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Información del evento', level: 1 })).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Información del evento/);
    await expect(page.getByRole('listitem').filter({ hasText: 'Primera nota' })).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('listitem').filter({ hasText: 'Second note' })).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('blockquote').filter({ hasText: 'Un mapa es un punto de partida.' })).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('blockquote').filter({ hasText: 'Every street has a story.' })).toHaveAttribute('lang', 'en');
    await expect(page.getByText(/Orientación para editar enlaces|Editor guidance for placing links/)).toHaveCount(0);
    const header = await page.getByRole('banner').ariaSnapshot();
    expect(header).toContain('button "Español" [pressed]');
    expect(header).toContain('group "Idioma del sitio"');
    const viewportFits = await page.locator('html').evaluate((html) => html.scrollWidth <= html.clientWidth + 1);
    expect(viewportFits).toBe(true);
    await writeFile(path.join(evidence, `public-language-${size}.json`), JSON.stringify({ width, header, focused: 'Español' }, null, 2));
    await page.screenshot({ path: path.join(evidence, `public-language-${size}.png`) });
  }
  const links = page.getByRole('main');
  for (const name of ['Leer la guía', 'Another guide', 'Open the guide']) {
    await expect(links.getByRole('link', { name, exact: true })).toHaveAttribute('href', `${route}?topic=data&lang=es#section-language-links`);
  }
  await expect(links.getByRole('link', { name: 'External source' })).toHaveAttribute('href', 'https://example.org/?lang=en#external');
  await expect(links.getByRole('link', { name: 'Unsafe destination' })).toHaveCount(0);
  await links.getByRole('link', { name: 'Open the guide' }).click();
  await expect(page).toHaveURL(/topic=data&lang=es#section-language-links$/);
  await page.goto('/signin?lang=es');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enviarme un código por correo' }).click();
  const validation = page.getByText('Escribe una dirección de correo válida, como tu@example.org.');
  await expect(validation).toBeVisible();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveAttribute('aria-invalid', 'true');
});

test('session units fall back together and live removal takes effect while the page is open', async ({ page }) => {
  await page.goto('/schedule?lang=es');
  await expect(page.getByRole('heading', { name: session.title, level: 3 })).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Clínica de mapas', level: 3 })).toHaveAttribute('lang', 'es');
  await page.goto(`/schedule/${session.id}?lang=es&preview=1`);
  const heading = page.getByRole('heading', { name: session.title, level: 1 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(heading).toHaveAttribute('lang', 'en');
  await expect(page.getByText(session.description, { exact: true })).toHaveAttribute('lang', 'en');
  await expect(page.getByText(session.room, { exact: true })).toBeVisible();
  await expect(page.locator(`time[datetime$="T${session.startTime}"]`)).toHaveText('13:15');
  await expect(page.getByRole('heading', { name: 'Borrador privado' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: session.titleEs })).toHaveCount(0);
  expect((await draftRef.get()).get('translations.es.title')).toBe('Borrador privado');

  await page.goto('/schedule/language-complete?lang=es');
  await expect(page.getByRole('heading', { name: 'Clínica de mapas', level: 1 })).toHaveAttribute('lang', 'es');
  const { translations: _translations, ...englishSession } = completeSession;
  try {
    await completeRef.set(englishSession);
    await expect(page.getByRole('heading', { name: 'Map clinic', level: 1 })).toHaveAttribute('lang', 'en');
    await completeRef.set(completeSession);
    await expect(page.getByRole('heading', { name: 'Clínica de mapas', level: 1 })).toBeVisible();
    const { contentLanguages: _language, ...englishEvent } = originalEvent.data();
    await event.set({ ...englishEvent, name: 'Example Language Event', historicalDemo: false });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Map clinic', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Español', exact: true })).toHaveCount(0);
  } finally {
    await event.set(bilingualEvent, { merge: true });
    await completeRef.set(completeSession);
  }
});

test('calendar exports and document descriptions use the language of each published session', async ({ page }) => {
  for (const [id, actualLanguage, title, description] of [
    ['language-complete', 'es', 'Clínica de mapas', 'Trae un mapa.'],
    [session.id, 'en', session.title, session.description],
  ]) {
    await page.goto(`/schedule/${id}?lang=es`);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description);
    await page.getByRole('button', { name: 'Agregar al calendario', exact: true }).click();
    const google = new URL(await page.getByRole('link', { name: /Google Calendar/ }).getAttribute('href'));
    expect(google.searchParams.get('text')).toBe(title);
    expect(google.searchParams.get('details')).toBe(description);
    expect(google.searchParams.get('dates')).toBe('20991015T171500Z/20991015T174500Z');
    expect(google.searchParams.get('location')).toContain('Cedar Room');

    const outlook = new URL(await page.getByRole('link', { name: /Outlook/ }).getAttribute('href'));
    expect(outlook.searchParams.get('subject')).toBe(title);
    expect(outlook.searchParams.get('body')).toBe(description);
    expect(outlook.searchParams.get('startdt')).toBe('2099-10-15T17:15:00.000Z');
    expect(outlook.searchParams.get('location')).toContain('Cedar Room');

    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Archivo de calendario (.ics)', exact: true }).click();
    const file = await downloaded;
    const ics = (await readFile(await file.path(), 'utf8')).replaceAll('\r\n ', '');
    expect(ics).toContain(`SUMMARY;LANGUAGE=${actualLanguage}:${title}\r\n`);
    expect(ics).toContain(`DESCRIPTION;LANGUAGE=${actualLanguage}:${description}\r\n`);
    expect(ics).toContain('DTSTART:20991015T171500Z\r\n');
    expect(ics).toContain('LOCATION:Cedar Room');

    if (actualLanguage === 'es') {
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await expect(page).toHaveTitle('Map clinic · Example Language Event');
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Bring a map.');
    }
  }
});
