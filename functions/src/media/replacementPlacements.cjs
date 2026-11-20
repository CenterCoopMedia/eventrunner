'use strict';

const { THEME_LOGO_SLOTS } = require('shared/theme');

const DESCRIPTION_FIELDS = ['alt', 'caption', 'credit'];

// Destructive usage warnings also look for links and prose containing a
// path. Replacement changes only the fields the site renders as images.
function imagePlacements(collection, id, doc) {
  const placements = [];
  const add = (keys, description = [], requiredAlt = false) => {
    const value = keys.reduce((record, key) => record?.[key], doc);
    if (typeof value === 'string' && value) placements.push({ keys, value, description, requiredAlt });
  };
  switch (collection.replace(/_drafts$/, '')) {
    case 'cmsContent':
      if (doc?.blockType === 'image') add(['url'], DESCRIPTION_FIELDS, true);
      break;
    case 'cmsUpdates':
      add(['featuredImage', 'url'], DESCRIPTION_FIELDS, true);
      if (Array.isArray(doc?.content)) {
        doc.content.forEach((block, index) => {
          if (block?.type === 'image') add(['content', index, 'image', 'url'], DESCRIPTION_FIELDS, true);
        });
      }
      break;
    case 'cmsOrganizations':
      add(['logoPath']);
      break;
    case 'config':
      if (id === 'theme') {
        for (const slot of THEME_LOGO_SLOTS) add(['logos', slot]);
      } else if (id === 'event') {
        add(['seo', 'defaultOgImagePath']);
        add(['venue', 'map', 'image'], ['alt'], true);
      }
      break;
  }
  return placements;
}

function namesAsset(value, path, bucket) {
  if (value.trim() === path) return true;
  if (!bucket) return false;
  try {
    const url = new URL(value);
    if (url.origin === 'https://firebasestorage.googleapis.com') {
      const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
      return Boolean(match && decodeURIComponent(match[1]) === bucket && decodeURIComponent(match[2]) === path);
    }
    if (url.origin === 'https://storage.googleapis.com') {
      return decodeURIComponent(url.pathname) === `/${bucket}/${path}`;
    }
  } catch {
    // Other URLs and malformed data do not name this library asset.
  }
  return false;
}

function replacementReferences(doc, docPath, paths, bucket) {
  const [collection, id] = docPath.split('/');
  const label = [doc?.title, doc?.name, doc?.section && doc?.field && `${doc.section} · ${doc.field}`]
    .find((value) => typeof value === 'string' && value.trim())?.trim().slice(0, 120);
  return imagePlacements(collection, id, doc).flatMap(({ keys, value }) => (
    paths.filter((path) => namesAsset(value, path, bucket))
      .map((path) => ({ path, docPath, field: keys.join('.'), ...(label ? { label } : {}) }))
  ));
}

function withReplacement(object, keys, offset, placement, source, target, keepDescription) {
  const key = keys[offset];
  const next = Array.isArray(object) ? [...object] : { ...object };
  if (offset < keys.length - 1) {
    next[key] = withReplacement(object[key], keys, offset + 1, placement, source, target, keepDescription);
    return next;
  }
  next[key] = target.path;
  for (const field of placement.description) {
    if (!keepDescription) next[field] = target[field];
    else if (field === 'alt' && typeof object.alt !== 'string') next.alt = source.alt;
  }
  if (!keepDescription && next.translations && placement.description.length > 0) {
    next.translations = Object.fromEntries(Object.entries(next.translations).flatMap(([language, fields]) => {
      const kept = Object.fromEntries(Object.entries(fields ?? {}).filter(([field]) => !placement.description.includes(field)));
      return Object.keys(kept).length ? [[language, kept]] : [];
    }));
  }
  return next;
}

function replaceImageFields({ collection, id, doc, expected, source, target, bucket, keepDescription }) {
  const placements = new Map(imagePlacements(collection, id, doc).map((entry) => [entry.keys.join('.'), entry]));
  let next = doc;
  const changed = [];
  const failed = [];
  for (const field of expected) {
    const placement = placements.get(field);
    if (!placement || !namesAsset(placement.value, source.path, bucket)) {
      failed.push({ field, reason: 'This place changed after the usage check.' });
    } else {
      const parent = placement.keys.slice(0, -1);
      const currentAlt = parent.reduce((object, key) => object[key], doc).alt;
      const alt = keepDescription && typeof currentAlt === 'string' ? currentAlt.trim()
        : (keepDescription ? source.alt : target.alt);
      if (placement.requiredAlt && !alt) {
        failed.push({ field, reason: 'Add an image description to the replacement or keep the current one.' });
        continue;
      }
      next = withReplacement(next, placement.keys, 0, placement, source, target, keepDescription);
      changed.push(field);
    }
  }
  if (changed.length > 0 && collection === 'cmsContent') {
    delete next.seeded;
    delete next.seededAt;
  }
  return { next, changed, failed };
}

module.exports = { replacementReferences, replaceImageFields };
