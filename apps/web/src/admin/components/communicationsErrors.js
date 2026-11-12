export function communicationsError(error, fallback = 'The change could not be saved. Try again.') {
  if (/historical demo/i.test(error?.message ?? '')) return 'This demo cannot send emails or save changes. Open an editable event to continue.';
  if (error?.status === 401) return 'Your session has expired. Sign in again.';
  if (error?.status === 403) return 'You do not have access. Ask an event administrator for access.';
  if (error?.code === 'preview-stale' || /changed after the preview/i.test(error?.message ?? '')) return 'The message or recipients changed. Preview the email again before sending.';
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 600 &&
      typeof error.code === 'string' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
