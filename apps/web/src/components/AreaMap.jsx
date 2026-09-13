import { useEffect, useRef, useState } from 'react';
import ExternalLink from './ExternalLink.jsx';

export function openStreetMapCoordinates(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || url.protocol !== 'https:' || !['www.openstreetmap.org', 'openstreetmap.org'].includes(url.hostname)) return null;
    const latValue = url.searchParams.get('mlat');
    const lonValue = url.searchParams.get('mlon');
    if (!latValue?.trim() || !lonValue?.trim()) return null;
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
  } catch {
    return null;
  }
}

export default function AreaMap({ url }) {
  const coordinates = openStreetMapCoordinates(url);
  const lat = coordinates?.[0];
  const lon = coordinates?.[1];
  const container = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (lat == null || lon == null || !container.current) return undefined;
    let cancelled = false;
    let map;
    let started = false;
    let tiles;
    let tileTimer;
    let tileErrors = false;
    const tileEvents = {
      loading() {
        tileErrors = false;
        clearTimeout(tileTimer);
        tileTimer = setTimeout(() => { if (!cancelled) setFailed(true); }, 15000);
      },
      tileerror() {
        tileErrors = true;
        if (!cancelled) setFailed(true);
      },
      load() {
        clearTimeout(tileTimer);
        if (!cancelled) setFailed(tileErrors);
      },
    };
    setFailed(false);

    async function loadMap() {
      if (started) return;
      started = true;
      try {
        const [leaflet] = await Promise.all([
          import('leaflet'),
          import('leaflet/dist/leaflet.css'),
        ]);
        if (cancelled) return;
        map = leaflet.map(container.current, { scrollWheelZoom: false }).setView([lat, lon], 16);
        tiles = leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          updateWhenIdle: true,
          keepBuffer: 0,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        });
        tiles.on(tileEvents).addTo(map);
        leaflet.circleMarker([lat, lon], {
          radius: 8,
          color: 'currentColor',
          fillOpacity: 0.85,
        }).addTo(map).bindTooltip('Venue map reference', { permanent: true, direction: 'top' });
      } catch {
        clearTimeout(tileTimer);
        tiles?.off(tileEvents);
        map?.remove();
        map = null;
        if (!cancelled) setFailed(true);
      }
    }

    // Request tiles only after the map enters the viewport.
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            loadMap();
          }
        })
      : null;
    if (observer) observer.observe(container.current);
    else loadMap();
    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(tileTimer);
      tiles?.off(tileEvents);
      map?.remove();
    };
  }, [lat, lon]);

  if (!coordinates) return null;
  return (
    <figure className="my-lg">
      <div
        ref={container}
        role="region"
        aria-label="OpenStreetMap of the area around the venue"
        className="relative z-0 h-96 w-full text-text-primary"
      />
      {failed ? <p role="status" className="mt-xs text-body text-text-secondary">The map could not fully load. Use the OpenStreetMap link below.</p> : null}
      <figcaption className="mt-xs flex flex-wrap justify-between gap-xs font-data text-caption text-text-secondary">
        <ExternalLink href={url}>Explore the area on OpenStreetMap</ExternalLink>
        <ExternalLink href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</ExternalLink>
      </figcaption>
    </figure>
  );
}
