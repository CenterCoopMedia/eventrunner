import path from 'node:path';
import { isDemoModeFlag } from './src/lib/demoModeFlag.js';

/**
 * Demo mode always uses the committed snapshot. A shell can still hold
 * GENERATED_DIR from a client export, and a specimen build must not embed it.
 * Real deploys leave demo mode unset and pass GENERATED_DIR on purpose.
 */
export function resolveGeneratedDir(env, fallback) {
  const fromClient = !isDemoModeFlag(env.VITE_DEMO_MODE)
    && typeof env.GENERATED_DIR === 'string'
    && env.GENERATED_DIR !== '';
  return fromClient ? path.resolve(env.GENERATED_DIR) : fallback;
}
