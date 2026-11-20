'use strict';

const CAPTION_MODES = Object.freeze(['hidden', 'below', 'overlay', 'hover']);
const CAPTION_ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
const MAX_CAPTION_LENGTH = 500;
const MAX_CREDIT_LENGTH = 160;

function captionPlacementErrors(placement, prefix = '') {
  const errors = [];
  if (placement.captionMode !== undefined && !CAPTION_MODES.includes(placement.captionMode)) {
    errors.push(`${prefix}captionMode: choose hidden, below, overlay or hover.`);
  }
  if (placement.captionAlign !== undefined && !CAPTION_ALIGNMENTS.includes(placement.captionAlign)) {
    errors.push(`${prefix}captionAlign: choose left, center or right.`);
  }
  return errors;
}

module.exports = { CAPTION_MODES, CAPTION_ALIGNMENTS, MAX_CAPTION_LENGTH, MAX_CREDIT_LENGTH, captionPlacementErrors };
