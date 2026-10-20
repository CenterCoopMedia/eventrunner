import { useEffect, useMemo, useState } from 'react';
import { subscribeAdminCollection } from './adminSource.js';

/**
 * Organization representatives and their edits waiting for review (issue
 * #334), for every organization. Both stores are staff-readable and small:
 * one grant per account and one edit per organization, so the listeners
 * read them whole and the callers pick their organization's rows.
 */
export function useOrganizationRepresentatives() {
  const [grants, setGrants] = useState(null);
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribers = [
      subscribeAdminCollection('organization_representatives', (docs) => {
        setGrants(docs);
        setError(null);
      }, setError),
      subscribeAdminCollection('organization_edit_requests', (docs) => {
        setRequests(docs);
        setError(null);
      }, setError),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  const requestIds = useMemo(
    () => new Set((requests ?? []).filter((request) => Object.keys(request.fields ?? {}).length > 0).map((request) => request.id)),
    [requests],
  );

  return {
    ready: grants !== null && requests !== null,
    error,
    grantsFor: (organizationId) => (grants ?? [])
      .filter((grant) => grant.organizationId === organizationId)
      .sort((a, b) => String(a.email ?? '').localeCompare(String(b.email ?? ''))),
    requestFor: (organizationId) => (requestIds.has(organizationId)
      ? (requests ?? []).find((request) => request.id === organizationId) ?? null
      : null),
    hasRequest: (organizationId) => requestIds.has(organizationId),
  };
}
