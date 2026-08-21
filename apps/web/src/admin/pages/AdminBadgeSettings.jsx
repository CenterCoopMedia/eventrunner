// Badge configuration (issue #14), wired to updateBadges.
//
// config/badges is `{ categories: [{ id, label, maxPicks, badges: [{ id,
// label }] }] }` — attendees self-select from this set, capped per category
// by maxPicks (spec §4.5). Whole-doc replace, so the form always sends the
// complete set of categories.
//
// config/badges has no build-time snapshot (badges are live-only), so this
// form starts empty until the runtime doc arrives.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

function toForm(badges) {
  const categories = Array.isArray(badges?.categories) ? badges.categories : [];
  return categories.map((category) => ({
    id: category?.id ?? '',
    label: category?.label ?? '',
    maxPicks: Number.isInteger(category?.maxPicks) ? category.maxPicks : 1,
    badges: Array.isArray(category?.badges)
      ? category.badges.map((badge) => ({ id: badge?.id ?? '', label: badge?.label ?? '' }))
      : [],
  }));
}

function toPayload(categories) {
  return {
    categories: categories.map((category) => {
      const maxPicks = Number(category.maxPicks);
      return {
        id: category.id,
        label: category.label,
        maxPicks: Number.isInteger(maxPicks) ? maxPicks : category.maxPicks,
        badges: category.badges.map((badge) => ({ id: badge.id, label: badge.label })),
      };
    }),
  };
}

export default function AdminBadgeSettings() {
  const { badges, features } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [categories, setCategories] = useState(() => toForm(badges));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const adoptedRef = useRef(false);

  useEffect(() => {
    if (adoptedRef.current || !badges) return;
    adoptedRef.current = true;
    setCategories(toForm(badges));
  }, [badges]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => fieldErrors.get(field);

  const setCategory = (index, patch) =>
    setCategories((current) =>
      current.map((category, i) => (i === index ? { ...category, ...patch } : category)),
    );

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      await call('updateBadges', { badges: toPayload(categories) });
      setStatus('Saved. Attendees see the new set immediately.');
      showToast('Badges saved.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Badges</h1>
        <p className="text-sm text-brand-ink-muted">
          The badge set attendees pick from, grouped into categories with a cap
          on how many each attendee may choose.
        </p>
      </div>

      {features?.badges ? null : (
        <p role="status" className="rounded-brand border border-brand-ink/20 bg-brand-surface-alt px-3 py-2 text-sm text-brand-ink-muted">
          The badges feature is currently off, so this set is not shown to
          attendees. Turn it on under Features.
        </p>
      )}

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel
        title="Categories"
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() =>
              setCategories((current) => [
                ...current,
                { id: '', label: '', maxPicks: 1, badges: [] },
              ])
            }
          >
            Add category
          </button>
        }
      >
        {categories.length === 0 ? (
          <p className="text-sm text-brand-ink-muted">No badge categories configured.</p>
        ) : (
          <ol className="flex flex-col gap-6">
            {categories.map((category, index) => {
              const at = `badges.categories[${index}]`;
              return (
                <li
                  key={index}
                  className="rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-4"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label={`Category ${index + 1} id`}
                      value={category.id}
                      onChange={(value) => setCategory(index, { id: value })}
                      error={errorFor(`${at}.id`)}
                    />
                    <TextField
                      label={`Category ${index + 1} label`}
                      value={category.label}
                      onChange={(value) => setCategory(index, { label: value })}
                      error={errorFor(`${at}.label`)}
                    />
                    <TextField
                      label={`Category ${index + 1} max picks`}
                      type="number"
                      min="1"
                      value={category.maxPicks}
                      onChange={(value) =>
                        setCategory(index, { maxPicks: value === '' ? '' : Number(value) })
                      }
                      error={errorFor(`${at}.maxPicks`)}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-brand-ink">Badges</h3>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() =>
                        setCategory(index, {
                          badges: [...category.badges, { id: '', label: '' }],
                        })
                      }
                    >
                      Add badge to category {index + 1}
                    </button>
                  </div>
                  {category.badges.length === 0 ? (
                    <p className="mt-2 text-sm text-brand-ink-muted">No badges yet.</p>
                  ) : (
                    <ol className="mt-2 flex flex-col gap-3">
                      {category.badges.map((badge, badgeIndex) => (
                        <li key={badgeIndex} className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
                          <TextField
                            label={`Badge ${badgeIndex + 1} id — category ${index + 1}`}
                            value={badge.id}
                            onChange={(value) =>
                              setCategory(index, {
                                badges: category.badges.map((b, j) =>
                                  j === badgeIndex ? { ...b, id: value } : b,
                                ),
                              })
                            }
                            error={errorFor(`${at}.badges[${badgeIndex}].id`)}
                          />
                          <TextField
                            label={`Badge ${badgeIndex + 1} label — category ${index + 1}`}
                            value={badge.label}
                            onChange={(value) =>
                              setCategory(index, {
                                badges: category.badges.map((b, j) =>
                                  j === badgeIndex ? { ...b, label: value } : b,
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className={`${dangerButtonClass} self-end`}
                            onClick={() =>
                              setCategory(index, {
                                badges: category.badges.filter((_, j) => j !== badgeIndex),
                              })
                            }
                          >
                            Remove badge {badgeIndex + 1}
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}

                  <button
                    type="button"
                    className={`${dangerButtonClass} mt-4`}
                    onClick={() =>
                      setCategories((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Remove category {index + 1}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <div>
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : 'Save badges'}
        </button>
      </div>
    </form>
  );
}
