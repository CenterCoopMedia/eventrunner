import { useEffect } from 'react';
import { eventMetaDescription, metaExcerpt } from 'shared/pageMetadata';

function setDescription(content) {
  let meta = document.head.querySelector('meta[name="description"]');
  if (!content) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);
  }
  meta.content = content;
}

/** Keep the description current when a detail route navigates or changes language. */
export function useDocumentDescription(event, description) {
  const fallback = eventMetaDescription(event);
  useEffect(() => {
    setDescription(metaExcerpt(description) || fallback);
    return () => setDescription(fallback);
  }, [description, fallback]);
}
