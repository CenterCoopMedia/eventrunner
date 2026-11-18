import { Suspense } from 'react';
import LoadingState from './LoadingState.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';

export default function DeferredPage({ component: Component, label, shape = 'rows' }) {
  const { text } = usePublicLanguage();
  return (
    <Suspense fallback={<LoadingState label={text(`Loading ${label}…`, 'Cargando…')} shape={shape} />}>
      <Component />
    </Suspense>
  );
}
