import { describe, expect, it } from 'vitest';
import { publicToolsEnabled } from './PublicWebMcpRegistration.jsx';

describe('public WebMCP feature gate', () => {
  it('enables the demo or the explicit client feature', () => {
    expect(publicToolsEnabled({
      demoMode: true,
      features: {},
      readSource: 'published',
    })).toBe(true);
    expect(publicToolsEnabled({
      demoMode: false,
      features: { webmcpPublic: true },
      readSource: 'published',
    })).toBe(true);
  });

  it('defaults off for client deployments and never registers over draft preview', () => {
    expect(publicToolsEnabled({
      demoMode: false,
      features: {},
      readSource: 'published',
    })).toBe(false);
    expect(publicToolsEnabled({
      demoMode: true,
      features: { webmcpPublic: true },
      readSource: 'draft',
    })).toBe(false);
  });
});

