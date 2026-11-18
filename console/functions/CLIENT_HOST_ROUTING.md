# Client-host routing

The router takes the HTTPS request URL from the ingress and a host lookup bound to that exact hostname. The lookup normalizes each published enrollment with the shared public-base resolver, which supplies `origin`, `mount` and `assetBase` alongside the fixed `hostingOrigin` and lifecycle `state`. The URL must retain the raw request path through validation. Where ingress normalizes before the router, reject ambiguous paths at that ingress using its raw path field. Cloudflare exposes [`raw.http.request.uri.path`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/raw.http.request.uri.path/) for this purpose.

The router refuses repeated separators, dot segments, backslashes, malformed escapes, encoded separators, encoded unreserved characters and nested escapes. It matches a complete mount and removes it once. A bare event mount redirects to its trailing-slash home with the original query. The host fallback owns unrelated paths, including `/__/` and `/.well-known/`. Firebase helper paths under an event mount return 404. An unknown, retired or removed mount returns 404. A network failure, timeout or upstream 5xx returns 503.

Hosting handles app-relative paths, rewrites and static files. The router forwards GET and HEAD, and forwards POST only for the exact event `/unsubscribe` path. It sends the query unchanged and streams the POST body with its content type. It sends no client cookies, authorization or forwarding headers to Firebase. It requests identity encoding for streamed bodies, keeps event security and cache headers and bypasses shared caching. The host owns HSTS. The router strips cookie, refresh and data-clearing headers and limits a service worker's explicit scope to that event. Failures log a class, hostname, known mount and available upstream status.

The router checks GET and HEAD redirects on the fixed Hosting origin before returning a public `Location`. Redirects can target app-relative paths on the same Hosting origin or already-mounted paths on the same public host. The router blocks reserved Firebase helper paths, sibling destinations, external origins, repeated targets and chains longer than four hops. POST redirects are refused to avoid replaying an unsubscribe. Keep the fixed Hosting address available for rollback.

## Cutover windows

The route-map projection takes the enrollment's `published` state so the mounted deployment can run its public smoke check before recording `appliedPublicBase`. A map entry can omit its listing title by supplying `null` until the event is ready for the public index.

From route publication until the mounted build reaches Hosting, the standalone address works and the mount may fail to render because its origin still serves the root-based build. Once the mounted build replaces that build on Hosting, the mount becomes the visitor address. The old standalone origin serves the mounted bundle from that point, including the window before smoke and the applied receipt finish.

The shared-host rehearsal in #1063 covers the order that keeps both windows short, the redirect or notice at the old visitor address, and recovery after a failed deployment or smoke step. Recovery restores the affected event’s standalone build and its matching route and URL settings together.

## Worker runtime

The Worker entry point is `client-host-worker.mjs`. Its `CLIENT_ROUTE_MAP_BUCKET` binding identifies the dedicated bucket holding the Console’s public projection. The exact request hostname selects `<host>.json`. The Worker reads that object without caching. The Console retains the writer identity.

The Worker lists public event titles and links at `/` once the mounted deployment is confirmed. A map with zero confirmed listings serves the empty index. `/.well-known/eventrunner-route-map` reports the `version` and `exportedAt` of the map currently in use. Unmatched mounts return 404. An optional `CLIENT_HOST_FALLBACK` service preserves existing responses on reserved host paths, including root Firebase helper paths.

The hosted fixtures use synthetic maps and upstreams. Raw ingress normalization, cache rules, bucket permissions, supported browsers and provider setup are part of the shared-host rehearsal.
