import config, { ADMIN_SPECIMEN_CONTENT, EXCLUDE_TEST_CONTENT, SPECIMEN_CONTENT } from './tailwind.config.js';

export default { ...config, content: [SPECIMEN_CONTENT, `!${ADMIN_SPECIMEN_CONTENT}`, EXCLUDE_TEST_CONTENT] };
