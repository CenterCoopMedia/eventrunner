import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { ADMIN_TOOL_DEFINITIONS } from './adminTools.js';
import { mountToolSet, resolveModelContext } from './registration.js';

const PAGE_EDITOR_RE = /^\/admin\/pages\/([A-Za-z0-9_-]{1,64})$/;

export function currentAdminPageId(pathname) {
  const match = pathname.match(PAGE_EDITOR_RE);
  return match && match[1] !== 'new' ? match[1] : null;
}

export function adminToolsEnabled({ features, user, adminStatus }) {
  return features.webmcpAdmin === true && Boolean(user) && adminStatus === 'admin';
}

export default function AdminWebMcpRegistration() {
  const { pathname } = useLocation();
  const { features } = useEventConfig();
  const { user, adminStatus } = useAuth();
  const stateRef = useRef(null);
  stateRef.current = { user, currentPageId: currentAdminPageId(pathname) };

  const enabled = adminToolsEnabled({ features, user, adminStatus });
  useEffect(() => {
    if (!enabled) return undefined;
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    return mountToolSet({
      modelContext,
      setId: 'eventrunner-admin',
      definitions: ADMIN_TOOL_DEFINITIONS,
      stateRef,
    });
  }, [enabled, user?.uid]);

  return null;
}

