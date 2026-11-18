import { stripEventMount } from 'shared/config/publicPath';
import { IS_DEMO } from './demoMode.js';

// Vite has already validated and normalized this base to one trailing slash.
export function eventMount() {
  return import.meta.env.BASE_URL.slice(0, -1);
}

export function eventAppPath(pathname) {
  return IS_DEMO ? pathname : stripEventMount(pathname, eventMount());
}
