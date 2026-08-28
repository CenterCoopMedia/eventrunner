# Public bundle budget

The budget measures the JavaScript graph required for the first public route. It does not hide weight by moving the same required code into a large vendor file.

## Measurement

- Build the normal deployment and the static demo.
- Record the raw and gzip size of the entry chunk and every chunk that it imports before route interaction.
- Report the largest modules in the initial graph before and after a split.
- Exclude lazy route chunks from the initial total, but give each lazy chunk its own ceiling.
- Keep the measurement script deterministic and run it in CI after the web build.

The first committed limits must be below the measured pre-change initial graph. Later changes can reduce a limit. They must not raise a limit without a written reason and new measurements.

## Split rules

- Split at route or feature boundaries that a visitor can understand.
- Keep the existing admin boundary lazy.
- Move rarely used public workflows behind route-level imports when their providers and shared shell do not require them.
- Keep each lazy route inside the current chunk error boundary and an accessible loading state.
- Prefetch only after clear user intent, such as focus, hover, or navigation preparation. Do not download every route during the first paint.
- Do not duplicate Firebase or shared application state across chunks.
- Do not change caching or chunk names only to suppress Vite's warning.

## Acceptance

The public entry graph stays within its CI limit in both build modes. Direct navigation, client navigation, loading, chunk failure recovery, and demo hash routes continue to work.
