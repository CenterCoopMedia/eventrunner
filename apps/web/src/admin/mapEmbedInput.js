import { googleMapsEmbedUrl } from 'shared/urlSafety';

const IFRAME = /^<iframe(\s[\s\S]*?)>\s*<\/iframe>$/i;
const ATTRIBUTE = /\s+([a-z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/giy;

export function mapEmbedInput(value) {
  const input = value.trim();
  if (!input.startsWith('<')) return googleMapsEmbedUrl(input);

  const frame = IFRAME.exec(input);
  if (!frame) return '';
  // Read a single iframe tag as text. Only its src can reach the URL checker.
  const attributes = frame[1].trimEnd();
  let end = 0;
  let src;
  for (const attribute of attributes.matchAll(ATTRIBUTE)) {
    end += attribute[0].length;
    if (attribute[1].toLowerCase() !== 'src') continue;
    if (src !== undefined) return '';
    src = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
  }
  if (end !== attributes.length || !src) return '';
  return googleMapsEmbedUrl(src.replaceAll('&amp;', '&'));
}
