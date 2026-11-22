import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { ticketingRequest } from '../lib/ticketingCommerce.js';
import DeferredPage from './DeferredPage.jsx';

const InitialReadContext = createContext(null);

function startRead(user) {
  const controller = new AbortController();
  const result = ticketingRequest('ticketingMyTickets', { user, body: {}, signal: controller.signal });
  return { user, controller, result };
}

export function useInitialMyTicketsRead() {
  return useContext(InitialReadContext);
}

export function takeMyTicketsRead(initialRead, user) {
  const prepared = initialRead?.current;
  if (prepared?.user !== user) return startRead(user);
  initialRead.current = null;
  return prepared;
}

export default function MyTicketsRoute(props) {
  const { user, loading } = useAuth();
  const { eventConfig } = useEventConfig();
  const eligibleUser = !loading && user?.emailVerified && !isReadOnlyDemo(eventConfig) ? user : null;
  const initialRead = useRef(null);

  // Start outside the page's Suspense boundary. Once the page takes the
  // read, it owns cancellation and any subsequent retry or refresh.
  useLayoutEffect(() => {
    if (!eligibleUser) return undefined;
    const read = startRead(eligibleUser);
    void read.result.catch(() => {}); // The lazy page may attach after a failure.
    initialRead.current = read;
    return () => {
      if (initialRead.current !== read) return;
      initialRead.current = null;
      read.controller.abort();
    };
  }, [eligibleUser]);

  return <InitialReadContext.Provider value={initialRead}><DeferredPage {...props} /></InitialReadContext.Provider>;
}
