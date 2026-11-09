// /admin/pitches/settings: the call for sessions, the pitch form's choices,
// and the pitch emails, on one page apart from the queue (ADR 0008, admin
// review). Operators change them. Staff see that only operators can.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { readPitchNoticeSettings } from 'shared/pitch';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { subscribePitchCall } from '../../lib/pitchSource.js';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminDoc } from '../adminSource.js';
import PitchCallSettings from '../components/PitchCallSettings.jsx';
import PitchFormOptions from '../components/PitchFormOptions.jsx';
import { PitchEmailSettings } from '../components/PitchEmails.jsx';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';
import { Notice, secondaryButtonClass } from '../components/formControls.jsx';

export default function AdminPitchSettings() {
  const call = useAdminApi();
  const { isOperator } = useAuth();
  const { eventConfig } = useEventConfig();
  const [settings, setSettings] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [noticeSettings, setNoticeSettings] = useState(null);
  useEffect(() => subscribePitchCall((value) => { setSettings(value); setConfigError(false); }, () => setConfigError(true)), []);
  useEffect(() => subscribeAdminDoc('session_pitch_settings/notices', (stored) => {
    setNoticeSettings({ ...readPitchNoticeSettings(stored), revision: stored?.revision ?? 0 });
  }), []);
  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Pitch call settings"
        description="When the call is open, where people pitch, the choices on the pitch form, and the emails to people who pitch."
        actions={<Link to="/admin/pitches" className={secondaryButtonClass}>Back to the queue</Link>}
      />
      {!isOperator ? <Notice tone="info" message="Only operators can change these settings. Ask an operator to open or close the call." /> : null}
      {configError ? <Notice tone="caution" message="Cannot check call settings. Reconnecting…" /> : null}
      {isOperator && !settings && !configError ? <AdminLoadingState label="Loading the call settings…" /> : null}
      {isOperator && settings && !configError ? (
        <>
          <PitchCallSettings settings={settings} call={call} timeZone={eventConfig?.timezone} />
          <PitchFormOptions settings={settings} call={call} />
        </>
      ) : null}
      {isOperator && noticeSettings ? <PitchEmailSettings settings={noticeSettings} call={call} /> : null}
    </div>
  );
}
