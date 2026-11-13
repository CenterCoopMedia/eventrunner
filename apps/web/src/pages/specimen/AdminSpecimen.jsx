import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import AdminPageHeader, { RecordState } from '../../admin/components/adminChrome.jsx';
import { Notice, secondaryButtonClass } from '../../admin/components/formControls.jsx';
import '../../admin/adminWorkspace.css';
import { applyMode } from '../../lib/modeRuntime.js';
import { buildRuntimeThemeCss } from '../../lib/themeRuntime.js';
import useNoIndex from './useNoIndex.js';
import AdminExamples from './AdminExamples.jsx';

const SHORT_DESCRIPTION = 'Real Admin devices with synthetic data and local example actions.';
const LONG_DESCRIPTION = 'Review the same tables, queues, previews and editing controls that staff use. Every account, address, message and invoice in this document is synthetic. Example actions stay here; they never load or save records, publish changes or send a message.';

export default function AdminSpecimen() {
  useNoIndex();
  const [params, setParams] = useSearchParams();
  const selectedMode = params.get('mode') ?? new URLSearchParams(window.location.search).get('mode');
  const mode = selectedMode === 'dark' ? 'dark' : 'light';
  const [longDescription, setLongDescription] = useState(true);
  const [navigation, setNavigation] = useState('');

  useEffect(() => {
    const title = document.title;
    const previousMode = document.documentElement.dataset.mode;
    const style = document.createElement('style');
    style.textContent = buildRuntimeThemeCss({ adminScheme: 'navy' });
    document.head.appendChild(style);
    document.title = 'Admin specimen book';
    return () => {
      style.remove();
      document.title = title;
      applyMode(previousMode === 'dark' ? 'dark' : 'light');
    };
  }, []);
  useEffect(() => { applyMode(mode); }, [mode]);

  function holdExampleNavigation(event) {
    const link = event.target.closest('a[href]');
    const href = link?.getAttribute('href') ?? '';
    if (!href.includes('/admin')) return;
    event.preventDefault();
    setNavigation(`Example link: ${link.textContent.trim()}. The example stays here.`);
  }

  return (
    <main className="admin-room min-h-screen bg-admin-ground font-admin-ui text-admin-ink" onClickCapture={holdExampleNavigation}>
      <div className="admin-stone mx-auto flex max-w-admin-canvas flex-col gap-md px-md py-lg lg:px-lg">
        <AdminPageHeader title="Admin devices" description={longDescription ? LONG_DESCRIPTION : SHORT_DESCRIPTION}
          state={<div className="flex flex-wrap gap-xs"><RecordState state={{ id: 'live', label: 'Live' }} /><RecordState state={{ id: 'draft', label: 'Draft' }} /><RecordState state={{ id: 'dirty', label: 'Live with unpublished changes' }} /></div>}
          actions={<div className="flex flex-wrap gap-xs">{['light', 'dark'].map((value) => (
            <button type="button" key={value} aria-pressed={mode === value} className={secondaryButtonClass} onClick={() => setParams({ mode: value })}>{value === 'light' ? 'Light mode' : 'Dark mode'}</button>
          ))}</div>} />
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" className={secondaryButtonClass} onClick={() => setLongDescription((value) => !value)}>{longDescription ? 'Show short description' : 'Show long description'}</button>
          <Link to="/specimen" className="admin-target text-admin-ink-link underline">Public specimen book</Link>
          <p className="text-admin-sm text-admin-ink-secondary">Source Sans 3 / IBM Plex Mono. Navy house scheme.</p>
        </div>
        {navigation ? <Notice message={navigation} /> : null}
        <AdminExamples />
      </div>
    </main>
  );
}
