'use strict';

/** Only Stripe's diagnostic identifiers; never its message, request or body. */
function stripeErrorDetails(error) {
  const details = {};
  for (const key of ['type', 'code']) {
    if (typeof error?.[key] === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(error[key])) details[key] = error[key];
  }
  if (Number.isInteger(error?.statusCode)) details.statusCode = error.statusCode;
  if (typeof error?.requestId === 'string' && /^req_[A-Za-z0-9]{1,100}$/.test(error.requestId)) details.requestId = error.requestId;
  return details;
}

module.exports = { stripeErrorDetails };
