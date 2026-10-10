// Same two values as the inline comparisons in demoMode.js. That file cannot
// call this function: the client build would keep the demo branches.
export function isDemoModeFlag(value) {
  return value === '1' || value === 'true';
}
