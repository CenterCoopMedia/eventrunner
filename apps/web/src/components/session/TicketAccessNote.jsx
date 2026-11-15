// A session control with its ticket access refusal stated under it (#1007):
// "Access updating" or "Your ticket does not include this session". The
// words are announced once, as a status, and stay until the reader, the
// session or a later answer changes.
export default function TicketAccessNote({ text, children }) {
  return (
    <span className="inline-flex flex-col items-start gap-3xs">
      {children}
      <span role="status" className="font-data text-caption text-text-secondary">
        {text}
      </span>
    </span>
  );
}
