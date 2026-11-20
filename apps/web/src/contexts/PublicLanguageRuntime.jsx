import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPath, useLocation, useNavigate } from 'react-router';
import { contentLanguages, resolveContentVariant } from 'shared/contentLanguages';
import { homepageMetadata } from 'shared/homepageMetadata';
import { languageFromSearch, withContentLanguage } from 'shared/languageUrls';
import { isPublicPage } from 'shared/page';
import { isDrawable, useContent } from './ContentContext.jsx';
import { useEventConfig } from './EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { englishLanguage, isAdminRoute } from './PublicLanguageContext.jsx';

const spanishText = (_en, es) => es;
const preferenceKey = `eventrunner:language:${IS_DEMO ? 'demo' : import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'site'}`;

function readPreference() {
  try {
    return globalThis.localStorage.getItem(preferenceKey);
  } catch {
    return null;
  }
}

function savePreference(language) {
  try {
    globalThis.localStorage.setItem(preferenceKey, language);
  } catch {
    // The active choice also lives in this provider and on route links.
  }
}

function hasApprovedSpanish(content, event, features) {
  const translated = (record, kind) => resolveContentVariant(record, kind, 'es', event).language === 'es';
  return content.pages?.some((page) => isPublicPage(page, features)
    && (translated(page, 'page')
      || (Array.isArray(page.sections) && page.sections.some((section) => translated(section, 'section')))))
    || Object.values(content.siteContent ?? {}).some((block) => isDrawable(block) && translated(block, 'block'))
    || (features?.schedule && content.scheduleData?.some((session) => session.visible && translated(session, 'session')));
}

export default function PublicLanguageRuntime({ onChange }) {
  const location = useLocation();
  const navigate = useNavigate();
  const config = useEventConfig();
  const content = useContent();
  const { eventConfig, sources, features } = config;
  const { available, default: defaultLanguage } = contentLanguages(eventConfig);
  const [saved, setSaved] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const isAdmin = isAdminRoute(location.pathname);
  const multilingual = available.includes('es');
  const configReady = IS_DEMO || sources?.event === 'live';
  const recordsReady = IS_DEMO || (sources?.features === 'live' && content.languageRecordsReady);
  const requested = languageFromSearch(location.search);
  const explicit = available.includes(requested) ? requested : null;
  const savedLanguage = available.includes(saved) ? saved : null;
  const language = explicit ?? savedLanguage ?? defaultLanguage;

  useEffect(() => {
    setSaved(readPreference());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || isAdmin) return;
    if (explicit && (explicit === 'en' || configReady)) {
      if (saved !== explicit) {
        setSaved(explicit);
        savePreference(explicit);
      }
      return;
    }
    // A Spanish URL may be valid once live configuration arrives. Keep it
    // intact and wait before remembering any automatic choice.
    if (!configReady || savedLanguage || content.readSource === 'draft') return;
    if (multilingual && !recordsReady) return;
    const browserLanguage = globalThis.navigator?.language?.toLowerCase().split('-')[0];
    const initial = browserLanguage === 'es' && multilingual && hasApprovedSpanish(content, eventConfig, features)
      ? 'es'
      : browserLanguage === 'en' ? 'en' : defaultLanguage;
    setSaved(initial);
    savePreference(initial);
  }, [hydrated, isAdmin, explicit, configReady, saved, savedLanguage, content, multilingual, recordsReady, eventConfig, features, defaultLanguage]);

  // Put the effective choice in a multilingual visit's history entry, so
  // switching language and then going Back restores the previous language.
  useEffect(() => {
    if (isAdmin || !hydrated || !configReady || !multilingual || explicit || !savedLanguage) return;
    navigate(withContentLanguage(createPath(location), savedLanguage), {
      replace: true, state: location.state,
    });
  }, [isAdmin, hydrated, configReady, multilingual, explicit, savedLanguage, location, navigate]);

  useEffect(() => {
    if (isAdmin) return;
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { root.lang = previous; };
  }, [isAdmin, language]);

  const urlLanguage = explicit ?? (multilingual ? savedLanguage : null);
  const localizedContent = useMemo(() => language === 'es' ? projectContent(content, eventConfig) : content,
    [content, language, eventConfig]);
  const homeTitlePart = useMemo(() => {
    if (location.pathname !== '/' || (requested === 'es' && !explicit && !configReady)) return undefined;
    const { getBlock } = content;
    const { text } = homepageMetadata(eventConfig, [getBlock('hero', 'title'), getBlock('hero', 'subtitle')]);
    return (text[language] ?? text.en).titlePart;
  }, [location.pathname, requested, explicit, configReady, content, eventConfig, language]);
  const value = useMemo(() => isAdmin ? englishLanguage : {
    language,
    available: multilingual && (Boolean(explicit || savedLanguage) || (configReady && content.readSource === 'draft'))
      ? available : englishLanguage.available,
    urlLanguage,
    sourceContent: content,
    localizedContent,
    homeTitlePart,
    localize: (href) => isAdminRoute(href) ? href : withContentLanguage(href, urlLanguage),
    text: language === 'es' ? spanishText : englishLanguage.text,
    select: (next) => {
      if (next === language || !available.includes(next)) return;
      navigate(withContentLanguage(createPath(location), next), {
        state: { ...location.state, languageSwitch: true },
      });
    },
  }, [isAdmin, language, multilingual, explicit, savedLanguage, configReady, content, available, urlLanguage, localizedContent, homeTitlePart, navigate, location]);

  useLayoutEffect(() => onChange(value), [onChange, value]);
  return null;
}

function translatedRecord(record, kind, event) {
  if (!record) return record;
  const { value, language } = resolveContentVariant(record, kind, 'es', event);
  return { ...value, publicLanguage: language };
}

function projectContent(content, eventConfig) {
  const project = (record, kind) => translatedRecord(record, kind, eventConfig);
  const page = (record) => {
    if (!record) return record;
    const translated = project(record, 'page');
    if (!Array.isArray(record.sections)) return translated;
    return { ...translated, sections: record.sections.map((section) => project(section, 'section')) };
  };
  return {
    ...content,
    pages: content.pages?.map(page),
    scheduleData: content.scheduleData?.map((record) => project(record, 'session')),
    getPage: content.getPage && ((...args) => page(content.getPage(...args))),
    getPublicPage: content.getPublicPage && ((...args) => page(content.getPublicPage(...args))),
    getBlock: content.getBlock && ((...args) => project(content.getBlock(...args), 'block')),
    getSectionBlocks: content.getSectionBlocks && ((...args) => content.getSectionBlocks(...args).map((record) => project(record, 'block'))),
  };
}
