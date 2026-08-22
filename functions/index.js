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
const mediaUpload = require('./src/media/upload.cjs');
const mediaMetadata = require('./src/media/metadata.cjs');
const mediaUsage = require('./src/media/usage.cjs');
const adminConfig = require('./src/admin/config.cjs');
const adminLiveUpdates = require('./src/admin/liveUpdates.cjs');
const adminFeedback = require('./src/admin/feedback.cjs');
const scheduleBookmarks = require('./src/schedule/bookmarks.cjs');
const schedulePdf = require('./src/schedule/pdf.cjs');
const publicOg = require('./src/public/og.cjs');
const scheduleReactions = require('./src/schedule/reactions.cjs');
const usersLifecycle = require('./src/users/lifecycle.cjs');
const usersProjection = require('./src/users/projection.cjs');
const speakersProfile = require('./src/speakers/profile.cjs');
const speakersLifecycle = require('./src/speakers/lifecycle.cjs');
const speakersProjection = require('./src/speakers/projection.cjs');
const speakersInvites = require('./src/speakers/invites.cjs');
const clientErrors = require('./src/telemetry/clientErrors.cjs');
const systemErrors = require('./src/telemetry/systemErrors.cjs');
const systemErrorsAdmin = require('./src/telemetry/systemErrorsAdmin.cjs');
const materialsStore = require('./src/materials/store.cjs');
const materialsReview = require('./src/materials/review.cjs');
const materialsAccess = require('./src/materials/access.cjs');
const materialsDownload = require('./src/materials/download.cjs');
const materialsProjection = require('./src/materials/projection.cjs');
const ticketingRegistry = require('./src/ticketing/index.cjs');
const ticketingWebhook = require('./src/ticketing/webhook.cjs');
const ticketingSync = require('./src/ticketing/sync.cjs');
const ticketingRegistration = require('./src/ticketing/registration.cjs');

module.exports = {
  ...email.handlers,
  ...auth.handlers,
  ...cmsContent.handlers,
  ...cmsPages.handlers,
  ...cmsVersions.handlers,
  ...cmsPublish.handlers,
  ...cmsUpdates.handlers,
  ...mediaUpload.handlers,
  ...mediaMetadata.handlers,
  ...mediaUsage.handlers,
  ...adminConfig.handlers,
  ...adminLiveUpdates.handlers,
  ...adminFeedback.handlers,
  ...scheduleBookmarks.handlers,
  ...schedulePdf.handlers,
  ...publicOg.handlers,
  ...scheduleReactions.handlers,
  ...usersLifecycle.handlers,
  ...usersProjection.handlers,
  ...speakersProfile.handlers,
  ...speakersLifecycle.handlers,
  ...speakersProjection.handlers,
  ...speakersInvites.handlers,
  ...clientErrors.handlers,
  ...systemErrors.handlers,
  ...systemErrorsAdmin.handlers,
  ...materialsStore.handlers,
  ...materialsReview.handlers,
  ...materialsAccess.handlers,
  ...materialsDownload.handlers,
  ...materialsProjection.handlers,
  ...ticketingRegistry.handlers,
  ...ticketingWebhook.handlers,
  ...ticketingSync.handlers,
  ...ticketingRegistration.handlers,
};
