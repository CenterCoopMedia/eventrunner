// Generic content page for the /p/:slug route (spec §5.2): renders any
// non-system cmsPages document from its sections. Placeholder until the
// pages tranche lands the section/block renderer.
// TODO(m2-pages): resolve the page from ContentProvider's cmsPages overlay
// and render its sections through the BLOCK_TYPES renderers.
import { useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState.jsx';

export default function ContentPage() {
  const { slug } = useParams();

  return (
    <EmptyState
      title="This page is not available yet"
      description={`No published page exists at /p/${slug}. If you followed a link here, the page may not be published yet.`}
    />
  );
}
