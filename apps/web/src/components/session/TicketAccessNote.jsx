// A session control with its ticket access refusal stated under it (#1007):
// "Access updating" or "Your ticket does not include this session". The
// wrapper and the status region are always rendered, so the control keeps
// its place and focus when the words appear or go.
export default function TicketAccessNote({ text, children }) {
  return (
    <span className="inline-flex flex-col items-start">
      {children}
      <span role="status" className={text ? 'mt-3xs font-data text-caption text-text-secondary' : undefined}>
        {text}
      </span>
    </span>
  );
}
