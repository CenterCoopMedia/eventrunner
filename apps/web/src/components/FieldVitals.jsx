import { useEffect } from 'react';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { setFieldVitalsEnabled } from '../lib/fieldVitals.js';

export default function FieldVitals() {
  const { features, available, featuresStatus } = useEventConfig();
  const { getPublicPage, publicPagesConfirmed } = useContent();
  // The public /privacy route supplies the disclosure even on sites seeded
  // before monitoring existed. A draft or a hidden page cannot supply it.
  const privacyPage = getPublicPage('/privacy', features);
  const privacyPublished = privacyPage?.path === '/privacy'
    && privacyPage.systemPage !== true;
  useEffect(() => {
    const unconfirmed = featuresStatus === null || featuresStatus === 'cached';
    if (unconfirmed) setFieldVitalsEnabled(null);
    else if (!available.features || features.coreWebVitals !== true) setFieldVitalsEnabled(false);
    else setFieldVitalsEnabled(publicPagesConfirmed ? privacyPublished : null);
  }, [available.features, features.coreWebVitals, featuresStatus, publicPagesConfirmed, privacyPublished]);
  return null;
}
