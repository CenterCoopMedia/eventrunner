// Names the current route in the tab, for every route that has no record
// of its own to name (spec §5.2; M7 issue 4).
//
// Renders nothing. It exists because the two halves of the title live in
// two providers: EventConfigProvider knows the event name and owns the
// write to document.title, and it sits OUTSIDE ContentProvider, which is
// where the page documents are. So the part is resolved here, inside the
// content provider and inside the router, and published to the same small
// store EventConfigContext already listens to.
//
// A page that IS showing a record — a session, a speaker, a content page —
// names itself through useDocumentTitle and wins over what this derives.
// What is left is the listing routes (/schedule, /speakers, /sponsors,
// /updates, /attendees) and the home page, which render their own
// components and would otherwise show the server's title for a moment and
// then drop to the bare event name.
import { useLocation } from 'react-router';
import { languageFromSearch } from 'shared/languageUrls';
import { isPublicPage } from 'shared/page';
import { homepageMetadata } from 'shared/homepageMetadata';
import { useContent } from '../contexts/ContentContext.jsx';
import { usePublicContent } from '../contexts/PublicLanguageProvider.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { routeTitlePartFor, useDerivedDocumentTitle } from '../lib/useDocumentTitle.js';

export default function RouteTitle() {
  const { pathname, search } = useLocation();
  const { pages } = usePublicContent();
  const { getBlock } = useContent();
  const { language, text } = usePublicLanguage();
  const { eventConfig, features } = useEventConfig();
  let part = routeTitlePartFor({ pathname, pages, features, pitchTitle: text('Pitch a session', 'Proponer una sesión') });
  if (!IS_DEMO && pathname === '/' && isPublicPage(pages?.find(({ id }) => id === 'home'), features)) {
    const home = homepageMetadata(eventConfig, [getBlock('hero', 'title'), getBlock('hero', 'subtitle')]);
    const locale = languageFromSearch(search) ?? language;
    part = (home.text[locale] ?? home.text.en).titlePart;
  }
  useDerivedDocumentTitle(part);
  return null;
}
