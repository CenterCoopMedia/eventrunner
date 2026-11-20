import config, { ADMIN_CONTENT, ADMIN_SPECIMEN_CONTENT, EXCLUDE_TEST_CONTENT } from './tailwind.config.js';

export default { ...config, content: [ADMIN_CONTENT, ADMIN_SPECIMEN_CONTENT, EXCLUDE_TEST_CONTENT] };
