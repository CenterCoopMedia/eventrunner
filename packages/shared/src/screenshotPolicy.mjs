export const MAX_SCREENSHOTS = 3;
export const MIB = 1024 * 1024;
export const PUBLIC_SCREENSHOT_MIB = 1;
export const SIGNED_IN_SCREENSHOT_MIB = 5;

export function screenshotTotalMib(mib) {
  // Three 2 MiB screenshots fit the original signed-in request budget.
  return mib === SIGNED_IN_SCREENSHOT_MIB ? 6 : mib * MAX_SCREENSHOTS;
}
