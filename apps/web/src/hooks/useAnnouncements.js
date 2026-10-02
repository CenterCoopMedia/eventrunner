import { useEffect, useMemo, useState } from 'react';
import { activeAnnouncements, announcementTimeMs } from 'shared/announcement';
import { subscribeAnnouncements } from '../lib/announcementsSource.js';

export function useAnnouncements() {
  const [records, setRecords] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => subscribeAnnouncements(setRecords), []);

  // Re-evaluate at the next start or end boundary even if Firestore does not
  // emit another snapshot while the page stays open.
  useEffect(() => {
    const nextBoundary = records
      .flatMap((record) => [announcementTimeMs(record.startsAt), announcementTimeMs(record.endsAt)])
      .filter((value) => value !== null && value > nowMs)
      .sort((a, b) => a - b)[0];
    if (nextBoundary === undefined) return undefined;
    const timeout = setTimeout(
      () => setNowMs(Date.now()),
      Math.min(Math.max(nextBoundary - Date.now(), 1), 2_147_483_647),
    );
    return () => clearTimeout(timeout);
  }, [nowMs, records]);

  return useMemo(() => activeAnnouncements(records, nowMs), [nowMs, records]);
}
