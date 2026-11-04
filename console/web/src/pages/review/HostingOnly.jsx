import { Link } from 'react-router';

/** What a reader who is not on the hosting team sees on a review page. */
export default function HostingOnly() {
  return (
    <section className="panel narrow" aria-labelledby="hosting-only-title">
      <h1 id="hosting-only-title" tabIndex={-1}>This page is for the hosting team</h1>
      <p><Link to="/">Go to your organizations</Link></p>
    </section>
  );
}

/** True when the server refused because the reader is not an operator. */
export function isNotOperator(error) {
  return error?.code === 'not-operator';
}
