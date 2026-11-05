import { useState } from 'react';

/** A save result describes the submitted values, never later edits. */
export function useSavedMessage(value) {
  const fingerprint = JSON.stringify(value);
  const [record, setRecord] = useState(null);
  const message = record?.fingerprint === fingerprint ? record.message : '';
  // Each render's setter closes over that render's values. An async save
  // therefore records the snapshot it sent, even if typing continued.
  function setMessage(next, savedValue = value) {
    setRecord(next ? { message: next, fingerprint: JSON.stringify(savedValue) } : null);
  }
  return [message, setMessage];
}
