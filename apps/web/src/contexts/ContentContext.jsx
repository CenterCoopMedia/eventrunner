// ContentProvider — placeholder (M2 content tranche replaces the body).
//
// First paint serves the committed snapshot (via the @generated alias).
// TODO(m2-content-runtime): subscribe to the published cms collections
// (cmsContent, cmsSchedule, cmsOrganizations, cmsTimeline, cmsUpdates,
// cmsPages — visible == true) and overlay the snapshot (spec §2.4).
// readSource 'draft' points the subscriptions at the *_drafts sibling
// collections for admin preview; firestore.rules — not this prop — is what
// enforces who may read drafts. ?preview=1 is convenience only.
import { createContext, useContext, useMemo } from 'react';
import siteContent from '@generated/siteContent.js';
import scheduleData, { speakers } from '@generated/scheduleData.js';
import organizationsData from '@generated/organizationsData.js';

const ContentContext = createContext(null);

export function ContentProvider({ readSource = 'published', children }) {
  const value = useMemo(
    () => ({
      readSource,
      siteContent,
      scheduleData,
      speakers,
      organizationsData,
      loading: false,
      /**
       * Convenience accessor for a cmsContent block by section + field.
       * Returns the whole block doc (blockType decides which fields exist)
       * or null. No hardcoded fallback text — event-neutrality (spec §5.3).
       */
      getBlock: (section, field) => siteContent[`${section}__${field}`] ?? null,
    }),
    [readSource],
  );
  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContent() {
  const ctx = useContext(ContentContext);
  if (!ctx) {
    throw new Error('useContent must be used inside <ContentProvider>.');
  }
  return ctx;
}

export default ContentContext;
