// Schedule page — placeholder the schedule tranche replaces.
// TODO(m2-schedule): day tabs from eventConfig.days, session cards, session
// detail routes, bookmarks behind config/features.sessionBookmarks.
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Schedule() {
  const { eventConfig } = useEventConfig();
  const { scheduleData } = useContent();

  const visibleSessions = scheduleData.filter((s) => s.visible);

  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Schedule</h1>
      {visibleSessions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="The schedule is not published yet"
            description="Check back soon — sessions appear here as they are announced."
          />
        </div>
      ) : (
        eventConfig.days.map((day) => {
          const sessions = visibleSessions
            .filter((s) => s.dayId === day.id)
            .sort((a, b) => a.order - b.order);
          return (
            <section key={day.id} aria-labelledby={`day-${day.id}`} className="mt-8">
              <h2 id={`day-${day.id}`} className="font-heading text-xl text-brand-ink">
                {day.label} · <time dateTime={day.date}>{day.date}</time>
              </h2>
              <ul className="mt-3 grid gap-3">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4"
                  >
                    <p className="text-sm text-brand-ink-muted" data-numeric>
                      {session.startTime}–{session.endTime} · {session.location}
                    </p>
                    <h3 className="mt-1 font-semibold text-brand-ink">{session.title}</h3>
                    <p className="mt-1 max-w-prose text-brand-ink-muted">
                      {session.description}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </article>
  );
}
