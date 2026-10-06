import { IS_DEMO } from './demoMode.js';

/** Static showcases and deployed historical fixtures disable account actions. */
export function isReadOnlyDemo(eventConfig, staticDemo = IS_DEMO) {
  return staticDemo || eventConfig?.historicalDemo === true;
}
