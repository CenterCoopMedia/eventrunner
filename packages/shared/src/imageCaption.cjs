'use strict';

const { isMediaLibraryPath, storageObjectPath } = require('./venue.cjs');

const CAPTION_MODES = Object.freeze(['hidden', 'below', 'overlay', 'hover']);
const CAPTION_ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
const MAX_CAPTION_LENGTH = 500;
const MAX_CREDIT_LENGTH = 160;

function imageCaptionAssetId(path) {
  const objectPath = storageObjectPath(path);
  if (!isMediaLibraryPath(objectPath)) return null;
  const parts = objectPath.split('/');
  return parts.length > 2 ? parts[1] : null;
}

function validDescriptionOverride(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3
    && typeof value.assetId === 'string' && value.assetId.length > 0 && !value.assetId.includes('/')
    && typeof value.caption === 'string' && value.caption.length <= MAX_CAPTION_LENGTH
    && typeof value.credit === 'string' && value.credit.length <= MAX_CREDIT_LENGTH);
}

function captionPlacementErrors(placement, prefix = '') {
  const errors = [];
  if (placement.captionMode !== undefined && !CAPTION_MODES.includes(placement.captionMode)) {
    errors.push(`${prefix}captionMode: choose hidden, below, overlay or hover.`);
  }
  if (placement.captionAlign !== undefined && !CAPTION_ALIGNMENTS.includes(placement.captionAlign)) {
    errors.push(`${prefix}captionAlign: choose left, center or right.`);
  }
  if (placement.descriptionOverride !== undefined && !validDescriptionOverride(placement.descriptionOverride)) {
    errors.push(`${prefix}descriptionOverride: invalid saved image description.`);
  }
  return errors;
}

module.exports = {
  CAPTION_MODES, CAPTION_ALIGNMENTS, MAX_CAPTION_LENGTH, MAX_CREDIT_LENGTH,
  imageCaptionAssetId, validDescriptionOverride, captionPlacementErrors,
};
