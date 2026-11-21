// Answers stay in this tab, scoped to the signed-in reader and request.
// Only these form fields can enter browser storage. Connection credentials
// and any other properties carried by the application stay out of the copy.
const KEPT_FIELDS = {
  organization: ['name', 'website', 'address'],
  event: ['name', 'shortName', 'tagline', 'timezone'],
  webAddress: ['name'],
  tickets: ['choice'],
  email: ['senderName', 'replyTo'],
};

function textFields(value, names) {
  const fields = {};
  for (const name of names) {
    const text = value?.[name];
    if (typeof text === 'string') fields[name] = text;
  }
  return fields;
}

function keptValue(value) {
  const { step, answers } = value ?? {};
  if (!Object.hasOwn(KEPT_FIELDS, step) || !answers) return null;
  const fields = textFields(answers, KEPT_FIELDS[step]);
  if (step === 'tickets' && answers.choice === null) fields.choice = null;
  if (step === 'event') {
    if (Array.isArray(answers.days)) {
      fields.days = answers.days.map((day) => textFields(day, ['date', 'startTime', 'endTime', 'label']));
    }
    if (answers.venue) fields.venue = textFields(answers.venue, ['name', 'address']);
  }
  return Object.keys(fields).length ? { step, answers: fields } : null;
}

function userPrefix(userId) {
  return `console.setup.${encodeURIComponent(userId)}:`;
}

function key(scope, step) {
  return scope?.userId ? `${userPrefix(scope.userId)}${JSON.stringify([scope.orgId, scope.appId, step])}` : null;
}

export function readKeptAnswer(scope, step) {
  try {
    const name = key(scope, step);
    const value = name && JSON.parse(window.sessionStorage.getItem(name));
    return value?.step === step ? keptValue(value) : null;
  } catch {
    return null;
  }
}

export function keepAnswer(scope, value) {
  try {
    const kept = keptValue(value);
    const name = kept && key(scope, kept.step);
    if (!name) return false;
    window.sessionStorage.setItem(name, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

export function removeKeptAnswer(scope, value) {
  try {
    // An older response must not remove a newer answer's copy.
    const kept = keptValue(value);
    if (kept && JSON.stringify(readKeptAnswer(scope, kept.step)) === JSON.stringify(kept)) {
      window.sessionStorage.removeItem(key(scope, kept.step));
    }
  } catch {
    // Storage can be blocked.
  }
}

export function clearRequestKeptAnswers(scope) {
  if (!scope?.userId) return;
  try {
    for (const step of Object.keys(KEPT_FIELDS)) {
      window.sessionStorage.removeItem(key(scope, step));
    }
  } catch {
    // Storage can be blocked.
  }
}

export function clearKeptAnswers(userId) {
  try {
    const prefix = userPrefix(userId);
    for (const name of Object.keys(window.sessionStorage)) {
      if (name.startsWith(prefix)) window.sessionStorage.removeItem(name);
    }
  } catch {
    // Storage can be blocked.
  }
}
