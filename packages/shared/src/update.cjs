'use strict';

// The non-wrapping category tag appears on Home and the Updates page. Keep
// its shared rule independent of the validators for rich update blocks.
const UPDATE_CATEGORY_MAX = 24;

function validUpdateCategory(value) {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const length = value.trim().length;
  return length >= 1 && length <= UPDATE_CATEGORY_MAX;
}

const DEFAULT_LATEST_UPDATES_COUNT = 3;
const MAX_LATEST_UPDATES_COUNT = 6;

function validLatestUpdatesCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_LATEST_UPDATES_COUNT;
}

module.exports = {
  UPDATE_CATEGORY_MAX, validUpdateCategory,
  DEFAULT_LATEST_UPDATES_COUNT, MAX_LATEST_UPDATES_COUNT, validLatestUpdatesCount,
};
