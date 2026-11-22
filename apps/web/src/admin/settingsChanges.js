function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Compare the form's serialized values and send the stored value for each edit. */
export function settingsChanges(before, after, stored) {
  const changes = {};
  const expected = {};
  for (const [key, value] of Object.entries(after)) {
    const previous = before?.[key];
    if (JSON.stringify(value) === JSON.stringify(previous)) continue;
    const original = stored?.[key] ?? null;
    if (isMap(value) && isMap(previous)) {
      const nested = settingsChanges(previous, value, original);
      if (Object.keys(nested.changes).length === 0) continue;
      changes[key] = nested.changes;
      // A teammate may clear a map that previously held this field.
      expected[key] = isMap(original) ? { ...nested.expected, $present: true } : nested.expected;
    } else {
      changes[key] = value;
      // An optional map being added starts from null. A removed map or an
      // edited list compares the entire stored value.
      expected[key] = original;
    }
  }
  return { changes, expected };
}

/** Advance only the baseline for fields in a successful save. */
export function applySettingsChanges(stored, changes) {
  const next = { ...stored };
  for (const [key, value] of Object.entries(changes)) {
    next[key] = isMap(value) ? applySettingsChanges(stored?.[key], value) : value;
  }
  return next;
}

/** Use the admin API's readable field messages in inline settings notices. */
export function settingsConflict(error, labels = {}) {
  if (error?.code !== 'settings-conflict') return null;
  const fieldErrors = (error.fieldErrors ?? []).map((item) => labels[item.field]
    ? { ...item, message: `${labels[item.field]} changed since you opened these settings.` }
    : item);
  return {
    fieldErrors,
    message: fieldErrors.map((item) => item.message).join(' ') || error.message,
  };
}
