import { isStarterContent } from 'shared/seed';
import { googleMapsEmbedUrl } from 'shared/urlSafety';
import { venueAddress } from 'shared/venue';

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function mapBlockFields(block) {
  const label = trim(block?.label);
  const address = trim(block?.address);
  if (!label || isStarterContent({ label, address })) return null;
  if (block.useEventVenue === true) return { label, address };
  const src = googleMapsEmbedUrl(block.embedUrl);
  if (!src || src !== block.embedUrl || isStarterContent({ embedUrl: src })) return null;
  return { label, address, src };
}

export function mapVenueFields(venue) {
  const name = trim(venue?.name);
  if (!name || !trim(venue?.addressLine1)) return null;
  return { name, address: venueAddress(venue) };
}
