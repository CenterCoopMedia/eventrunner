// Error codes and stored field names stay available to the form, but the
// visible message uses the same language as the controls.
export function plannerMessage(message) {
  const text = String(message || 'This action did not finish. Try again.');
  if (/AIRTABLE_API_TOKEN|firebase|firestore|(?:cmsSchedule|cmsOrganizations|session_materials|speaker_logistics)\/|\b(?:schemaVersion|permission-denied|failed-precondition)\b/i.test(text)) {
    return 'This action could not finish. Try again or contact support.';
  }
  return text
    .replace(/must be a non-empty string/gi, 'Enter a value.')
    .replace(/must be (?:a )?string/gi, 'Enter text.')
    .replace(/must be (?:an? )?(?:integer|number)/gi, 'Enter a number.')
    .replace(/\bSlug:/g, 'Page link:')
    .replace(/\b(?:storagePath|headshotPath|logoPath)\b/g, 'File')
    .replace(/\b(?:firstName|lastName|jobTitle|startTime|endTime|lengthMinutes|materialsNotNeeded|audienceLevel|accessNeeds)\b/g,
      (key) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

export function plannerError(error) {
  return {
    ...error,
    message: plannerMessage(error?.message),
    ...(error?.fieldErrors ? { fieldErrors: error.fieldErrors.map((entry) => ({ ...entry, message: plannerMessage(entry.message) })) } : {}),
  };
}
