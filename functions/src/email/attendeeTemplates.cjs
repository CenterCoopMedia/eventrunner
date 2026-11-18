'use strict';

const { render } = require('./render.cjs');
const { TEXT_FOOTER_ES, wrap } = require('./templates/layout.cjs');

function spanish({ subject, html, text }) {
  return {
    subject,
    html: wrap(html.join('\n'), { language: 'es' }),
    text: [...text, '', TEXT_FOOTER_ES].join('\n'),
  };
}

function changeNotice(subject, lead) {
  const link = 'Consulta el estado en tu página de solicitudes de cambio:';
  return spanish({
    subject,
    html: [
      '<p>Hola:</p>', `<p>${lead}</p>`,
      `{{#if requests_url}}<p>${link}<br><a href="{{requests_url}}">{{requests_url}}</a></p>{{/if}}`,
      '<p>No hace falta responder a este correo.</p>',
    ],
    text: ['Hola:', '', lead, '', `{{#if requests_url}}${link}\n{{requests_url}}\n\n{{/if}}No hace falta responder a este correo.`],
  });
}

const SPANISH = {
  'announcement.email': spanish({
    subject: '{{announcement_subject}}',
    html: [
      '{{announcement_body}}',
      '{{#if cta_url}}<p><a href="{{cta_url}}">{{cta_label}}</a></p><p>Si el enlace no funciona, copia esta dirección en tu navegador:<br>{{cta_url}}</p>{{/if}}',
      '{{#if unsubscribe_url}}<p>Este es un aviso de {{event_name}}. <a href="{{unsubscribe_url}}">Dejar de recibir avisos</a>.</p>{{/if}}',
    ],
    text: [
      '{{announcement_body}}', '{{#if cta_url}}\n{{cta_label}}: {{cta_url}}\n{{/if}}',
      '{{#if unsubscribe_url}}Este es un aviso de {{event_name}}.\nDejar de recibir avisos: {{unsubscribe_url}}\n{{/if}}',
    ],
  }),
  'attendee.approved': spanish({
    subject: 'Ya tienes tu registro para {{event_name}}',
    html: [
      '<p>Hola, {{attendee_name}}:</p>',
      '<p>El equipo del evento aprobó tu registro para {{event_name}}.</p>',
      '<p><a href="{{dashboard_url}}">Abre tu panel</a></p>',
      '{{#if registration_url}}<p>Si todavía no has respondido las preguntas de registro, <a href="{{registration_url}}">respóndelas aquí</a>.</p>{{/if}}',
      '<p>¿Tienes preguntas? Responde a este mensaje.</p>',
    ],
    text: [
      'Hola, {{attendee_name}}:', '', 'El equipo del evento aprobó tu registro para {{event_name}}.', '',
      'Abre tu panel: {{dashboard_url}}', '',
      '{{#if registration_url}}Si todavía no has respondido las preguntas de registro, respóndelas aquí:\n{{registration_url}}\n\n{{/if}}¿Tienes preguntas? Responde a este mensaje.',
    ],
  }),
  'ticket.order_confirmation': spanish({
    subject: 'Tu pedido de entradas para {{event_name}}',
    html: [
      '<p>Tu pedido para {{event_name}} está confirmado.</p>',
      '<p>Pedido: {{order_reference}}<br>Entradas: {{ticket_count}}<br>Total: {{total_amount}}</p>',
      '<p><a href="{{cta_url}}">Consulta el pedido y tus entradas</a></p>',
      '<p>Cada asistente debe iniciar sesión con el correo asociado a su entrada para reclamarla. Si hubo un pago, Stripe envía el recibo por separado.</p>',
    ],
    text: [
      'Tu pedido para {{event_name}} está confirmado.', '', 'Pedido: {{order_reference}}',
      'Entradas: {{ticket_count}}', 'Total: {{total_amount}}', '', 'Consulta el pedido y tus entradas: {{cta_url}}', '',
      'Cada asistente debe iniciar sesión con el correo asociado a su entrada para reclamarla. Si hubo un pago, Stripe envía el recibo por separado.',
    ],
  }),
  'ticket.attendee_confirmation': spanish({
    subject: 'Tienes una entrada para {{event_name}}',
    html: [
      '<p>Hola, {{first_name}}:</p>',
      '<p>Entradas para {{event_name}} asignadas a este correo: {{ticket_count}}.</p>',
      '<p><a href="{{cta_url}}">Inicia sesión y reclama tu entrada</a></p>',
      '<p>Referencia del pedido: {{order_reference}}. Usa este correo para iniciar sesión. La referencia por sí sola no da acceso a tu entrada.</p>',
      '<p>Después de reclamarla, abre Mis entradas para ver o imprimir tu entrada.</p>',
    ],
    text: [
      'Hola, {{first_name}}:', '', 'Entradas para {{event_name}} asignadas a este correo: {{ticket_count}}.', '',
      'Inicia sesión y reclama tu entrada: {{cta_url}}', '', 'Referencia del pedido: {{order_reference}}.',
      'Usa este correo para iniciar sesión. La referencia por sí sola no da acceso a tu entrada.',
      'Después de reclamarla, abre Mis entradas para ver o imprimir tu entrada.',
    ],
  }),
  'changeRequest.received': changeNotice('Recibimos tu solicitud de cambio para {{event_name}}', 'Recibimos tu solicitud de cambio. El equipo del evento la revisará.'),
  'changeRequest.done': changeNotice('Se completó tu solicitud de cambio para {{event_name}}', 'El equipo del evento marcó tu solicitud de cambio como completada.'),
  'changeRequest.declined': changeNotice('Novedades sobre tu solicitud de cambio para {{event_name}}', 'El equipo del evento decidió no hacer el cambio que pediste.'),
};

function spanishTemplateVariant(id) {
  return Object.hasOwn(SPANISH, id) ? SPANISH[id] : undefined;
}

function renderAttendeeTemplate({ template, override, language, ...context }) {
  const variant = language === 'es' ? spanishTemplateVariant(template.id) : null;
  if (!variant) return render({ template, override, ...context });
  // A saved English override keeps its unit. Treat HTML and text as a pair.
  const localized = { ...template, subject: variant.subject };
  if (typeof override?.html !== 'string' && typeof override?.text !== 'string') {
    localized.html = variant.html;
    localized.text = variant.text;
  }
  return render({ template: localized, override, ...context });
}

function attendeeUrl(url, language) {
  if (!url || language !== 'es') return url;
  try {
    const target = new URL(url);
    target.searchParams.set('lang', 'es');
    return target.href;
  } catch {
    return url;
  }
}

module.exports = { renderAttendeeTemplate, attendeeUrl, spanishTemplateVariant };
