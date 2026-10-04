/** One set of requirements supplies both the outstanding list and the meter. */
export function speakerCompletion({ speaker, sessions, materialsBySession }) {
  const effective = { ...speaker, ...(speaker?.pendingEdits ?? {}) };
  const profilePath = '/speaker/profile';
  const requirements = [
    {
      id: 'bio',
      label: 'Add your biography',
      to: profilePath,
      complete: Boolean(effective.bio?.trim()),
    },
    {
      id: 'headshot',
      label: 'Add your headshot',
      to: profilePath,
      complete: Boolean(effective.headshotPath?.trim()),
    },
  ];

  const seenSessions = new Set();
  for (const session of sessions) {
    if (seenSessions.has(session.id)) continue;
    seenSessions.add(session.id);
    requirements.push({
      id: `materials:${session.id}`,
      label: `Send materials for ${session.title || 'your session'}`,
      to: `/speaker/dashboard?session=${encodeURIComponent(session.id)}&tab=materials#speaker-sessions-heading`,
      complete: (materialsBySession[session.id] ?? []).some(
        (material) => material.reviewStatus === 'pending' || material.reviewStatus === 'approved',
      ),
    });
  }

  return {
    completed: requirements.filter((item) => item.complete).length,
    total: requirements.length,
    outstanding: requirements.filter((item) => !item.complete),
  };
}
