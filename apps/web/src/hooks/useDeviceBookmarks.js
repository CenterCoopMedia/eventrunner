import { useSyncExternalStore } from 'react';
import { getDeviceBookmarks, subscribeDeviceBookmarks } from '../lib/deviceBookmarks.js';

const serverBookmarks = Object.freeze({ available: false, ids: [], merging: [] });
const getServerBookmarks = () => serverBookmarks;

export function useDeviceBookmarks() {
  return useSyncExternalStore(subscribeDeviceBookmarks, getDeviceBookmarks, getServerBookmarks);
}
