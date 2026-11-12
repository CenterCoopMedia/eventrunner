'use strict';

/**
 * Plain wording fields for the three speaker messages. The fixed fragments
 * own the email structure, links, conditional blocks, brand wrapper and
 * footer. Staff values can contain ordinary template tokens. The shared
 * wording service checks those values and the built source.
 */

const { internals: { escapeHtml } } = require('../render.cjs');
const { wrap, TEXT_FOOTER } = require('./layout.cjs');

const CONDITIONAL_MARKER_RE = /\{\{\s*(?:#if\b|\/if\b)/i;
const HTML_ENTITIES = Object.freeze({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" });

class SpeakerWordingFieldsError extends Error {}

function slot(field, channel = 'text') {
  return Object.freeze({ field, channel });
}

function wrappedBody(segments) {
  const marker = '__SPEAKER_WORDING_BODY__';
  const [before, after] = wrap(marker).split(marker);
  return [before, ...segments, after];
}

const SHAPES = Object.freeze({
  'speaker.invite': Object.freeze({
    defaults: Object.freeze({
      subject: 'You are invited to speak at {{event_name}}',
      greeting: 'Hi {{speaker_name}},',
      invitation: 'You are invited to take part in {{event_name}} ({{event_dates}}) as a {{invite_type}}.',
      signInInstructions: 'You will be asked to sign in — with Google, or with a code we email you — so we can connect this invitation to your account.',
      buttonLabel: 'Accept your invitation',
      backupLinkInstructions: 'If the button does not work, paste this address into your browser:',
      contactInstructions: 'Questions, or the wrong person? Reply to this message or write to',
    }),
    subject: [slot('subject')],
    html: wrappedBody([
      '<p style="margin:0 0 16px 0;">', slot('greeting', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;">', slot('invitation', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;">Use the link below to accept. ', slot('signInInstructions', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;text-align:center;">\n',
      '<a href="{{invite_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">', slot('buttonLabel', 'html'), '</a>\n',
      '</p>\n',
      '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">', slot('backupLinkInstructions', 'html'), '<br>{{invite_url}}</p>\n',
      '<p style="margin:0;">', slot('contactInstructions', 'html'), ' <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
    ]),
    text: [
      slot('greeting'), '\n\n',
      slot('invitation'), '\n\n',
      slot('buttonLabel'), ':\n{{invite_url}}\n\n',
      slot('signInInstructions'), '\n\n',
      slot('contactInstructions'), ' {{admin_contact_email}}.\n\n',
      TEXT_FOOTER,
    ],
  }),
  'speaker.accepted': Object.freeze({
    defaults: Object.freeze({
      subject: 'You are confirmed for {{event_name}}',
      greeting: 'Hi {{speaker_name}},',
      confirmation: 'Thank you — your place at {{event_name}} is confirmed, and this invitation is now linked to your account.',
      profileInstructions: 'Next, write your speaker profile — your biography, photograph, and organization — for the public programme:',
      buttonLabel: 'Write your speaker profile',
      reviewNote: 'Your speaker profile appears publicly once an organizer has reviewed it.',
    }),
    subject: [slot('subject')],
    html: wrappedBody([
      '<p style="margin:0 0 16px 0;">', slot('greeting', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;">', slot('confirmation', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;">', slot('profileInstructions', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;text-align:center;">\n',
      '<a href="{{profile_wizard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">', slot('buttonLabel', 'html'), '</a>\n',
      '</p>\n',
      '<p style="margin:0;">', slot('reviewNote', 'html'), '</p>',
    ]),
    text: [
      slot('greeting'), '\n\n',
      slot('confirmation'), '\n\n',
      slot('profileInstructions'), '\n{{profile_wizard_url}}\n\n',
      slot('reviewNote'), '\n\n',
      TEXT_FOOTER,
    ],
  }),
  'speaker.reminder': Object.freeze({
    defaults: Object.freeze({
      subject: 'Items we still need for {{event_name}}',
      greeting: 'Hi {{speaker_name}},',
      introduction: 'Thank you for speaking at {{event_name}}. We still need these items from you:',
      biographyItem: 'Add a short biography to your speaker profile.',
      headshotItem: 'Add a headshot to your speaker profile.',
      sessionDescriptionItem: 'Send us a description for: {{description_sessions}}.',
      materialsItem: 'Send your slides or other materials for: {{materials_sessions}}.',
      dueDateLine: 'Please send them by {{due_date}}.',
      buttonLabel: 'Open your speaker dashboard',
      backupLinkInstructions: 'If the button does not work, paste this address into your browser:',
      contactInstructions: 'Questions? Reply to this message or write to',
    }),
    subject: [slot('subject')],
    html: wrappedBody([
      '<p style="margin:0 0 16px 0;">', slot('greeting', 'html'), '</p>\n',
      '<p style="margin:0 0 16px 0;">', slot('introduction', 'html'), '</p>\n',
      '<ul style="margin:0 0 16px 0;padding-left:20px;">\n',
      '{{#if needs_bio}}<li>', slot('biographyItem', 'html'), '</li>{{/if}}\n',
      '{{#if needs_headshot}}<li>', slot('headshotItem', 'html'), '</li>{{/if}}\n',
      '{{#if description_sessions}}<li>', slot('sessionDescriptionItem', 'html'), '</li>{{/if}}\n',
      '{{#if materials_sessions}}<li>', slot('materialsItem', 'html'), '</li>{{/if}}\n',
      '</ul>\n',
      '{{#if due_date}}<p style="margin:0 0 16px 0;">', slot('dueDateLine', 'html'), '</p>{{/if}}\n',
      '<p style="margin:0 0 16px 0;text-align:center;">\n',
      '<a href="{{dashboard_url}}" style="display:inline-block;padding:12px 24px;background-color:{{brand_primary}};color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-weight:bold;text-decoration:none;">', slot('buttonLabel', 'html'), '</a>\n',
      '</p>\n',
      '<p style="margin:0 0 16px 0;font-size:13px;color:#777777;">', slot('backupLinkInstructions', 'html'), '<br>{{dashboard_url}}</p>\n',
      '<p style="margin:0;">', slot('contactInstructions', 'html'), ' <a href="mailto:{{admin_contact_email}}">{{admin_contact_email}}</a>.</p>',
    ]),
    text: [
      slot('greeting'), '\n\n',
      slot('introduction'), '\n\n',
      '{{#if needs_bio}}- ', slot('biographyItem'), '\n',
      '{{/if}}{{#if needs_headshot}}- ', slot('headshotItem'), '\n',
      '{{/if}}{{#if description_sessions}}- ', slot('sessionDescriptionItem'), '\n',
      '{{/if}}{{#if materials_sessions}}- ', slot('materialsItem'), '\n',
      '{{/if}}\n',
      '{{#if due_date}}', slot('dueDateLine'), '\n\n',
      '{{/if}}', slot('buttonLabel'), ':\n{{dashboard_url}}\n\n',
      slot('contactInstructions'), ' {{admin_contact_email}}.\n\n',
      TEXT_FOOTER,
    ],
  }),
});

function shapeFor(id) {
  const shape = SHAPES[id];
  if (!shape) throw new SpeakerWordingFieldsError(`templateId: ${id} does not have plain wording fields.`);
  return shape;
}

function fieldNames(shape) {
  return Object.keys(shape.defaults);
}

function readFields(id, input) {
  const shape = shapeFor(id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpeakerWordingFieldsError('fields: Must be an object.');
  }
  const names = fieldNames(shape);
  const unknown = Object.keys(input).filter((name) => !names.includes(name));
  if (unknown.length > 0) throw new SpeakerWordingFieldsError(`fields: Unknown field ${unknown[0]}.`);
  const missing = names.filter((name) => !(name in input));
  if (missing.length > 0) throw new SpeakerWordingFieldsError(`${missing[0]}: Enter wording for this field.`);
  const fields = {};
  for (const name of names) {
    const value = input[name];
    if (typeof value !== 'string') throw new SpeakerWordingFieldsError(`${name}: Must be text.`);
    if (value.trim().length === 0) throw new SpeakerWordingFieldsError(`${name}: Enter wording for this field.`);
    if (CONDITIONAL_MARKER_RE.test(value)) {
      throw new SpeakerWordingFieldsError(`${name}: Conditional blocks stay fixed and cannot be added to a wording field.`);
    }
    fields[name] = value;
  }
  return fields;
}

function buildChannel(segments, fields) {
  return segments.map((part) => {
    if (typeof part === 'string') return part;
    const value = fields[part.field];
    return part.channel === 'html' ? escapeHtml(value) : value;
  }).join('');
}

function buildSpeakerWording(id, input) {
  const shape = shapeFor(id);
  const fields = readFields(id, input ?? shape.defaults);
  return {
    subject: buildChannel(shape.subject, fields),
    html: buildChannel(shape.html, fields),
    text: buildChannel(shape.text, fields),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtml(value) {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity]);
}

function parseChannel(segments, source) {
  const slots = [];
  const pattern = segments.map((part) => {
    if (typeof part === 'string') return escapeRegExp(part);
    slots.push(part);
    return '([\\s\\S]*?)';
  }).join('');
  const match = new RegExp(`^${pattern}$`).exec(source);
  if (!match) return null;
  const fields = {};
  for (let index = 0; index < slots.length; index += 1) {
    const { field, channel } = slots[index];
    const value = channel === 'html' ? decodeHtml(match[index + 1]) : match[index + 1];
    if (fields[field] !== undefined && fields[field] !== value) return null;
    fields[field] = value;
  }
  return fields;
}

function parseSpeakerWording(id, source) {
  const shape = shapeFor(id);
  if (!source || typeof source.subject !== 'string' || typeof source.html !== 'string' || typeof source.text !== 'string') {
    return null;
  }
  const parts = [
    parseChannel(shape.subject, source.subject),
    parseChannel(shape.html, source.html),
  ];
  if (parts.some((part) => part === null)) return null;
  const fields = {};
  for (const part of parts) {
    for (const [name, value] of Object.entries(part)) {
      if (fields[name] !== undefined && fields[name] !== value) return null;
      fields[name] = value;
    }
  }
  if (fieldNames(shape).some((name) => fields[name] === undefined)) return null;
  try {
    const rebuilt = buildSpeakerWording(id, fields);
    if (rebuilt.subject !== source.subject || rebuilt.html !== source.html || rebuilt.text !== source.text) return null;
  } catch {
    return null;
  }
  return fields;
}

module.exports = {
  SpeakerWordingFieldsError,
  buildSpeakerWording,
  parseSpeakerWording,
  readSpeakerWordingFields: readFields,
  defaultSpeakerWordingFields: (id) => ({ ...shapeFor(id).defaults }),
};
