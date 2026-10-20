import { materialCounts, sessionNeedsMaterials, speakerHasBio, speakerHasHeadshot } from 'shared/speakerReadiness';

/**
 * One set of requirements supplies both the outstanding list and the meter.
 * The test behind each item is shared/speakerReadiness, the same rule the
 * staff reminder email reads, so a reminder never asks for an item this list
 * shows as done.
 */
export function speakerCompletion({ speaker, sessions, materialsBySession }) {
  const profilePath = '/speaker/profile';
  const requirements = [
    {
      id: 'bio',
      label: 'Add your biography',
      to: profilePath,
      complete: speakerHasBio(speaker),
    },
    {
      id: 'headshot',
      label: 'Add your headshot',
      to: profilePath,
      complete: speakerHasHeadshot(speaker),
    },
  ];

  const seenSessions = new Set();
  for (const session of sessions) {
    if (seenSessions.has(session.id)) continue;
    seenSessions.add(session.id);
    // A session staff marked as needing no materials asks for none.
    if (!sessionNeedsMaterials(session)) continue;
    requirements.push({
      id: `materials:${session.id}`,
      label: `Send materials for ${session.title || 'your session'}`,
      to: `/speaker/dashboard?session=${encodeURIComponent(session.id)}&tab=materials#speaker-sessions-heading`,
      complete: (materialsBySession[session.id] ?? []).some(materialCounts),
    });
  }

  return {
    completed: requirements.filter((item) => item.complete).length,
    total: requirements.length,
    outstanding: requirements.filter((item) => !item.complete),
  };
}
