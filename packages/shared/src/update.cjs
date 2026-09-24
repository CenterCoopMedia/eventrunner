'use strict';
const { isSafeUrl } = require('./urlSafety.cjs');
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
const localRoute = (value) => typeof value === 'string' && /^\/[a-z0-9][a-z0-9/?=&_-]*$/i.test(value);
function validUpdateImage(value) {
  return object(value) && keys(value, ['url', 'alt', 'caption']) && text(value.alt)
    && (isSafeUrl(value.url) || typeof value.url === 'string' && /^demo\/[a-z0-9-]+\.webp$/.test(value.url))
    && (value.caption === undefined || text(value.caption));
}
function validUpdateBlock(block) {
  if (!object(block)) return false;
  switch (block.type) {
    case 'richtext': return keys(block, ['type', 'value']) && text(block.value);
    case 'image': return keys(block, ['type', 'image']) && validUpdateImage(block.image);
    case 'button': return keys(block, ['type', 'label', 'href']) && text(block.label)
      && (localRoute(block.href) || isSafeUrl(block.href));
    case 'columns': return keys(block, ['type', 'columns']) && Array.isArray(block.columns)
      && block.columns.length === 2 && block.columns.every((column) => object(column)
        && keys(column, ['heading', 'body']) && text(column.heading) && text(column.body));
    case 'practicePoll': return keys(block, ['type', 'question', 'options']) && text(block.question)
      && Array.isArray(block.options) && block.options.length >= 2 && block.options.length <= 6
      && block.options.every(text) && new Set(block.options.map((option) => option.trim().replace(/\s+/g, ' '))).size === block.options.length;
    default: return false;
  }
}
function validUpdateContent(content) {
  return Array.isArray(content) && content.length <= 20 && content.every(validUpdateBlock);
}
// An update's category (issue #191): one short line the Updates page sets as
// a tag beside the title. The tag never wraps, so the cap keeps it inside a
// phone's width. cmsSaveUpdate refuses anything else on write, and the page
// draws nothing for a stored value that fails here on read.
const UPDATE_CATEGORY_MAX = 24;
function validUpdateCategory(value) {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const length = value.trim().length;
  return length >= 1 && length <= UPDATE_CATEGORY_MAX;
}
module.exports = { validUpdateImage, validUpdateBlock, validUpdateContent, UPDATE_CATEGORY_MAX, validUpdateCategory };
