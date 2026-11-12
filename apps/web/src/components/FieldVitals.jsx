import { useEffect } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { setFieldVitalsEnabled } from '../lib/fieldVitals.js';

export default function FieldVitals() {
  const { features, available, featuresStatus } = useEventConfig();
  useEffect(() => {
    if (featuresStatus === null) return;
    setFieldVitalsEnabled(available.features && features.coreWebVitals === true);
  }, [available.features, features.coreWebVitals, featuresStatus]);
  return null;
}
