import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { mountToolSet, resolveModelContext } from './registration.js';
import { PUBLIC_TOOL_DEFINITIONS } from './publicTools.js';

export function publicToolsEnabled({ demoMode, features, readSource }) {
  return (demoMode || features.webmcpPublic === true) && readSource === 'published';
}

export default function PublicWebMcpRegistration() {
  const { pathname } = useLocation();
  const { eventConfig, features, theme, source: configSource } = useEventConfig();
  const {
    pages,
    scheduleData,
    readSource,
    source: contentSource,
  } = useContent();
  const stateRef = useRef(null);
  stateRef.current = {
    pathname,
    eventConfig,
    features,
    theme,
    configSource,
    contentSource,
    pages,
    scheduleData,
    demoMode: IS_DEMO,
  };

  const enabled = publicToolsEnabled({ demoMode: IS_DEMO, features, readSource });
  useEffect(() => {
    if (!enabled) return undefined;
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    return mountToolSet({
      modelContext,
      setId: 'eventrunner-public',
      definitions: PUBLIC_TOOL_DEFINITIONS,
      stateRef,
    });
  }, [enabled]);

  return null;
}
