import { useLocation } from 'react-router';
import { homepageMetadata } from 'shared/homepageMetadata';
import { languageFromSearch } from 'shared/languageUrls';
import { isPublicPage } from 'shared/page';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { useDerivedDocumentTitle } from '../lib/useDocumentTitle.js';
import RouteTitle from './RouteTitle.jsx';

function HomeTitle({ search }) {
  const { getBlock, pages } = useContent();
  const { eventConfig, features } = useEventConfig();
  const { language } = usePublicLanguage();
  let part = null;
  if (isPublicPage(pages?.find(({ id }) => id === 'home'), features)) {
    const { text } = homepageMetadata(eventConfig, [getBlock('hero', 'title'), getBlock('hero', 'subtitle')]);
    const locale = languageFromSearch(search) ?? language;
    part = (text[locale] ?? text.en).titlePart;
  }
  useDerivedDocumentTitle(part);
  return null;
}

export default function HostedRouteTitle() {
  const { pathname, search } = useLocation();
  return pathname === '/' ? <HomeTitle search={search} /> : <RouteTitle />;
}
