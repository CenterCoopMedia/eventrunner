'use strict';

// Export barrel ONLY — no logic, no handler bodies (spec §1.3).
// Each domain module under src/ exports { handlers }, and every deployable
// export is re-exported here by name.

const email = require('./src/email/send.cjs');
const auth = require('./src/auth/otp.cjs');
const cmsContent = require('./src/cms/content.cjs');
const cmsPages = require('./src/cms/pages.cjs');
const cmsVersions = require('./src/cms/versions.cjs');
const cmsPublish = require('./src/cms/publish.cjs');
const cmsUpdates = require('./src/cms/updates.cjs');
const adminConfig = require('./src/admin/config.cjs');
const adminLiveUpdates = require('./src/admin/liveUpdates.cjs');
const adminFeedback = require('./src/admin/feedback.cjs');
const scheduleBookmarks = require('./src/schedule/bookmarks.cjs');
const usersLifecycle = require('./src/users/lifecycle.cjs');
const usersProjection = require('./src/users/projection.cjs');
const clientErrors = require('./src/telemetry/clientErrors.cjs');
const systemErrors = require('./src/telemetry/systemErrors.cjs');

module.exports = {
  ...email.handlers,
  ...auth.handlers,
  ...cmsContent.handlers,
  ...cmsPages.handlers,
  ...cmsVersions.handlers,
  ...cmsPublish.handlers,
  ...cmsUpdates.handlers,
  ...adminConfig.handlers,
  ...adminLiveUpdates.handlers,
  ...adminFeedback.handlers,
  ...scheduleBookmarks.handlers,
  ...usersLifecycle.handlers,
  ...usersProjection.handlers,
  ...clientErrors.handlers,
  ...systemErrors.handlers,
};
