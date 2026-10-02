'use strict';

/**
 * True when a Storage object belongs to the named session's materials
 * folder and names an object below that folder.
 *
 * @param {unknown} storagePath
 * @param {unknown} sessionId
 * @returns {boolean}
 */
function isSessionMaterialStoragePath(storagePath, sessionId) {
  if (typeof storagePath !== 'string' || typeof sessionId !== 'string' || !sessionId) return false;
  const prefix = `session-materials/${sessionId}/`;
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}

module.exports = { isSessionMaterialStoragePath };
