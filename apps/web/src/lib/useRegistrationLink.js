import { useEffect, useState } from 'react';
import { resolveRegistrationAction } from 'shared/registration';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from './readOnlyDemo.js';
import { ticketingRequest } from './ticketingCommerce.js';

export const DEFAULT_REGISTRATION_LABEL = 'Register';

/** The external destination remains shared with registration emails. */
export function resolveRegistrationLink(eventConfig) {
  const action = resolveRegistrationAction(eventConfig);
  return action ? { label: action.label ?? DEFAULT_REGISTRATION_LABEL, url: action.url } : null;
}

// Header and home lead share one credential-free provider lookup. The purchase
// page still fetches fresh inventory when it opens and after a capacity refusal.
const providerRequests = new Map();
function readProvider(key) {
  let entry = providerRequests.get(key);
  if (!entry || Date.now() - entry.at > 30_000) {
    entry = { at: Date.now(), promise: ticketingRequest('ticketingCatalog') };
    providerRequests.set(key, entry);
  }
  return entry.promise;
}

// The public catalog read answers a catalog revision only for a published
// catalog; the /tickets page reads the same field before it accepts terms.
function isPublishedCatalog(catalog) {
  return Number.isSafeInteger(catalog?.catalogRevision) && catalog.catalogRevision >= 0;
}

export function useRegistrationLink() {
  const { eventConfig } = useEventConfig();
  const endpoint = import.meta.env.VITE_FUNCTIONS_ORIGIN || import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const enabled = Boolean(endpoint) && !isReadOnlyDemo(eventConfig);
  const key = `${endpoint || ''}:${eventConfig?.id || ''}`;
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    readProvider(key).then((catalog) => {
      if (active) setResolved({ key, provider: catalog?.provider, published: isPublishedCatalog(catalog) });
    }).catch(() => {
      if (active) setResolved({ key, provider: null, published: null });
    });
    return () => { active = false; };
  }, [enabled, key]);

  if (enabled && resolved?.key !== key) return null;
  // Only a confirmed legacy provider may use its external destination.
  // An outage must not send a Stripe purchaser to an older checkout source;
  // the native page presents the catalog error and its retry control.
  if (enabled && !['eventbrite', 'manual', 'none'].includes(resolved?.provider)) {
    // A native action needs a published catalog. Until staff publish one, the
    // page could only say that sales are not configured, so no action shows.
    // A published catalog keeps the action while sales are paused or every
    // window is closed, so a visitor can read when sales open. An outage
    // (published is null) keeps it too: the page carries the retry control.
    if (resolved?.published === false) return null;
    return { label: 'Get tickets', url: '/tickets', native: true };
  }
  return resolveRegistrationLink(eventConfig);
}
