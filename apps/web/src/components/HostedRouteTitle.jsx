import { useLocation } from 'react-router';
import { homepageEventTitle, homepageTitlePart, publishedHeroText } from 'shared/homepageTitle';
import { languageFromSearch } from 'shared/languageUrls';
import { isPublicPage } from 'shared/page';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { useDerivedDocumentTitle } from '../lib/useDocumentTitle.js';
import RouteTitle from './RouteTitle.jsx';

function HomeTitle({ search }) {
  const content = useContent();
  const { getBlock, pages } = content;
  const { eventConfig, features } = useEventConfig();
  const { sourceContent, homeTitlePart } = usePublicLanguage();
  let part = null;
  if (isPublicPage(pages?.find(({ id }) => id === 'home'), features)) {
    const requested = languageFromSearch(search) ?? eventConfig.contentLanguages?.default;
    if (sourceContent === content && homeTitlePart !== undefined) part = homeTitlePart;
    else if (requested === 'es') part = undefined;
    else part = homepageTitlePart(publishedHeroText(getBlock('hero', 'title'), 'title'), homepageEventTitle(eventConfig));
  }
  useDerivedDocumentTitle(part);
  return null;
}

export default function HostedRouteTitle() {
  const { pathname, search } = useLocation();
  return pathname === '/' ? <HomeTitle search={search} /> : <RouteTitle />;
}
