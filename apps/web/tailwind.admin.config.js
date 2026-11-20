import config, { WEB_CONTENT } from './tailwind.config.js';

export default {
  ...config,
  // Include shared components for Tailwind's original base and variant order.
  // Scope to the document so controls in admin portals get the same utilities.
  important: ':where(html:has(.admin-room))',
  content: WEB_CONTENT,
};
