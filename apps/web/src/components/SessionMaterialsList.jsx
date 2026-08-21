// The approved-materials list on a session's detail page (issue #23, spec
// §4.4). Feature-gated by config/features.sessionMaterials, same as
// MaterialsPill (SessionCard.jsx). Rows come from the anonymously-readable
// `session_materials_public` projection — filename and type only, never a
// URL. Clicking a row resolves the real target via getSessionMaterialUrl,
// which applies the embargo gate server-side; a pre-embargo click (a
// signed-out visitor, or a signed-in attendee who is neither the session's
// speaker nor an admin) surfaces the server's refusal as inline text rather
// than a broken link.
import { useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { fetchSessionMaterialUrl } from '../lib/materialsSource.js';
import { useSessionMaterials } from '../hooks/useSessionMaterials.js';

const TYPE_LABEL = { link: 'Link', file: 'File' };

function MaterialRow({ material }) {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | error
  const onOpen = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { url } = await fetchSessionMaterialUrl({ user, materialId: material.id });
      setState({ status: 'idle' });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setState({ status: 'error', message: err.message || 'This material is not available yet.' });
    }
  }, [user, material.id]);

  return (
    <li className="flex flex-col gap-1 rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={state.status === 'loading'}
          className="touch-target text-start font-medium text-brand-primary-dark hover:underline disabled:opacity-50"
        >
          {material.filename}
        </button>
        <span className="text-xs text-brand-ink-muted">{TYPE_LABEL[material.type] ?? material.type}</span>
      </div>
      {state.status === 'error' ? (
        <p role="status" className="text-sm text-brand-ink-muted">{state.message}</p>
      ) : null}
    </li>
  );
}

/**
 * @param {{ session: object, features?: { sessionMaterials?: boolean } }} props
 */
export default function SessionMaterialsList({ session, features = {} }) {
  const { materials } = useSessionMaterials(features.sessionMaterials ? session?.id : undefined);
  if (!features.sessionMaterials || materials.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="font-heading text-lg font-semibold text-brand-ink">Materials</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {materials.map((material) => (
          <MaterialRow key={material.id} material={material} />
        ))}
      </ul>
    </section>
  );
}
