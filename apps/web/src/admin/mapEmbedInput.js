import { googleMapsEmbedUrl } from 'shared/urlSafety';

export function mapEmbedInput(value) {
  const input = value.trim();
  if (!input.startsWith('<')) return googleMapsEmbedUrl(input);

  // Template contents are inert. Copy only the validated src out of the template.
  const template = document.createElement('template');
  template.innerHTML = input;
  const frame = template.content.firstElementChild;
  if (template.content.childNodes.length !== 1 || frame?.tagName !== 'IFRAME') return '';
  return googleMapsEmbedUrl(frame.getAttribute('src'));
}
