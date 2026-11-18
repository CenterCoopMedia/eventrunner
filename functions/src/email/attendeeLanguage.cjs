'use strict';

const { contentLanguages } = require('shared/contentLanguages');

function registrationLanguage(event, requested) {
  return contentLanguages(event).available.includes(requested) ? requested : null;
}

function attendeeLanguage(registration, event) {
  const saved = registration?.registrationLanguage;
  return saved === 'en' || saved === 'es' ? saved : contentLanguages(event).default;
}

module.exports = { registrationLanguage, attendeeLanguage };
