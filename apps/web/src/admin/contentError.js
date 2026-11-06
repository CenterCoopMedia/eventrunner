// Content screens keep server diagnostics out of the organizer's message.
export function contentError(error, { labels = {}, fallback = 'The change could not be saved. Try again.' } = {}) {
  if (error?.clientValidation) return error;
  if (error?.contentPublishResult) return { message: error.message, fieldErrors: [] };
  const recovery = {
    unauthenticated: 'Your session has expired. Sign in again.',
    'permission-denied': 'You do not have access to make this change. Ask an event admin for help.',
    forbidden: 'You do not have access to make this change. Ask an event admin for help.',
    network: 'The connection failed. Check your connection and try again.',
  };
  const fieldErrors = (error?.fieldErrors ?? []).filter((item) => labels[item.field]).map((item) => ({
    field: item.field,
    message: `Check ${labels[item.field].toLowerCase()} and try again.`,
  }));
  return {
    message: recovery[error?.code] ?? fallback,
    fieldErrors,
  };
}
