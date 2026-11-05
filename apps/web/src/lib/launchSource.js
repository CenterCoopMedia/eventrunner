// Whether the site still shows its coming-soon page (config/launch).
//
// init-event writes `{ comingSoon: true }` on a new site's first run, and the
// team's first publish from the admin clears it (functions/src/cms/launch.cjs).
// First paint reads the build-time snapshot; the live document overrides it.
// A site with no document at all is an older site, and is open.
import { useEffect, useState } from 'react';
import * as snapshotConfig from '@generated/eventConfig.js';
import { subscribeConfigDoc } from './configSource.js';
import { IS_DEMO } from './demoMode.js';

function snapshotComingSoon() {
  try {
    return snapshotConfig.launch?.comingSoon === true;
  } catch {
    // A test double of the generated module may not state the export.
    return false;
  }
}

/** @returns {boolean} true while visitors should see the coming-soon page */
export function useComingSoon() {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (IS_DEMO) return undefined;
    return subscribeConfigDoc('launch', (data) => setLive(data?.comingSoon === true));
  }, []);
  if (IS_DEMO) return false;
  return live ?? snapshotComingSoon();
}
