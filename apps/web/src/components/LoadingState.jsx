// Designed loading state. Announces via role="status"; the pulse animation
// is suppressed globally under prefers-reduced-motion (index.css).
export default function LoadingState({ label = 'Loading' }) {
  return (
    <div role="status" className="flex flex-col gap-3 py-8" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="h-6 w-1/3 animate-pulse rounded-brand bg-brand-ink/10" />
      <div aria-hidden="true" className="h-4 w-2/3 animate-pulse rounded-brand bg-brand-ink/10" />
      <div aria-hidden="true" className="h-4 w-1/2 animate-pulse rounded-brand bg-brand-ink/10" />
    </div>
  );
}
