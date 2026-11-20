import config, { ADMIN_CONTENT, ADMIN_SPECIMEN_CONTENT, WEB_CONTENT } from './tailwind.config.js';

export default {
  ...config,
  // Scope to the mounted page so this sheet can stay cached between routes.
  important: ':where(html:has(.specimen-book))',
  content: [...WEB_CONTENT, `!${ADMIN_CONTENT}`, `!${ADMIN_SPECIMEN_CONTENT}`],
};
