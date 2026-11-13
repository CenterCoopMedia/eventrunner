// Answers stay in this tab, scoped to the signed-in reader and request.
function userPrefix(userId) {
  return `console.setup.${encodeURIComponent(userId)}:`;
}

function key(scope, step) {
  return scope?.userId ? `${userPrefix(scope.userId)}${JSON.stringify([scope.orgId, scope.appId, step])}` : null;
}

export function readKeptAnswer(scope, step) {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key(scope, step)));
    return value?.step === step && value.answers && typeof value.answers === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function keepAnswer(scope, value) {
  try {
    const name = key(scope, value.step);
    if (name) window.sessionStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Storage can be blocked or full; the normal save still runs.
  }
}

export function removeKeptAnswer(scope, value) {
  try {
    const name = key(scope, value.step);
    // An older response must not remove a newer answer's copy.
    if (window.sessionStorage.getItem(name) === JSON.stringify(value)) window.sessionStorage.removeItem(name);
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
