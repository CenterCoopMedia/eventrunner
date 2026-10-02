'use strict';

/** A single streamed material stays under the platform's 10,000,000-byte response limit. */
const MAX_MATERIAL_FILE_BYTES = 9 * 1024 * 1024;
/** Bound stored and downloaded display names without rejecting Unicode. */
const MAX_MATERIAL_FILENAME_LENGTH = 240;

/** Storage returns object sizes as decimal strings. Test fakes may use numbers. */
function parseStorageSize(raw) {
  let size = NaN;
  if (typeof raw === 'number') size = raw;
  else if (typeof raw === 'string' && /^\d+$/u.test(raw.trim())) size = Number(raw.trim());
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

class MaterialFileTooLargeError extends Error {
  constructor(size) {
    super(`The file is ${size} bytes. The limit is ${MAX_MATERIAL_FILE_BYTES} bytes (9 MiB).`);
    this.name = 'MaterialFileTooLargeError';
    this.size = size;
  }
}

class MaterialFileSizeUnavailableError extends Error {
  constructor() {
    super('The file size could not be read from Storage.');
    this.name = 'MaterialFileSizeUnavailableError';
  }
}

function requireAllowedMaterialFileSize(raw) {
  const size = parseStorageSize(raw);
  if (size === null) throw new MaterialFileSizeUnavailableError();
  if (size > MAX_MATERIAL_FILE_BYTES) throw new MaterialFileTooLargeError(size);
  return size;
}

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

module.exports = {
  MAX_MATERIAL_FILE_BYTES,
  MAX_MATERIAL_FILENAME_LENGTH,
  MaterialFileTooLargeError,
  MaterialFileSizeUnavailableError,
  isSessionMaterialStoragePath,
  parseStorageSize,
  requireAllowedMaterialFileSize,
};
