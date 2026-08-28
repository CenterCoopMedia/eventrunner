# Admin async test readiness

Admin page tests must wait for the page-owned data state that they inspect. The shared `renderAt` helper proves that the admin shell and route gate loaded. It does not prove that each page finished its own requests.

## Rules

- Use `findBy*` for the first element that depends on a page request.
- Use `waitFor` when readiness depends on more than one visible state or on the disappearance of a loading state.
- Use synchronous `getBy*` queries only after the test has awaited a stable, user-visible readiness signal.
- Do not pump the microtask queue with repeated `Promise.resolve()` calls.
- Do not add sleeps, longer timeouts, test retries, or serial execution to hide a race.
- A shared helper can wait for a page-ready marker only when that marker is part of the accessible interface. Do not add a test-only production marker.
- Keep failure-path tests asynchronous. A rejected request must reach the visible error state before the test asserts its copy or controls.

## Stress check

Run the complete web suite repeatedly with its normal parallel settings. A focused test that passes alone does not prove that the race is removed.
