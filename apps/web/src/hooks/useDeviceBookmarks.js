import { useSyncExternalStore } from 'react';
import { getDeviceBookmarks, subscribeDeviceBookmarks } from '../lib/deviceBookmarks.js';

export function useDeviceBookmarks() {
  return useSyncExternalStore(subscribeDeviceBookmarks, getDeviceBookmarks, getDeviceBookmarks);
}
