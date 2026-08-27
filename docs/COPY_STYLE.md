# Copy style

Use direct, operational English in every current user-facing surface.

This guide follows the main principles of ASD-STE100 Simplified Technical English. It is not a claim of formal ASD-STE100 certification.

## Write the action or fact first

Tell the reader what to do, what happened, what is required, or what a control changes.

Prefer:

- Select a site style.
- Save the page as a draft.
- The demo is read-only.
- This option reduces the schedule row height.

Do not introduce an instruction with sales language, a rhetorical question, or a general claim.

## Use one term for one concept

Use the same term in the interface, documentation, email, and support text.

- Use **site style** for a complete public-site design preset.
- Use **display mode** for light or dark mode.
- Use **admin panel** for the staff editing interface.
- Use **client deployment** for one client's Firebase project and event site.

Do not switch between near-synonyms to make the text sound varied.

## Keep sentences short

Use one main instruction or fact in each sentence. Split a sentence when it contains several conditions, results, or exceptions.

Use lists only when the reader must compare or complete several items.

## Use active verbs

Prefer:

- Select **Save draft**.
- Event Runner creates the page.
- The client owns the event data.

Avoid passive constructions when the actor matters.

## Describe design choices directly

State the visible change and its purpose.

Prefer:

- Uses condensed headings to fit long titles in less space.
- Adds a hairline rule below the header.
- Reduces row padding so more sessions fit on one page.

Do not describe a design as a character, story, voice, journey, or object that acts like a person.

## Remove unsupported promotion

Do not use broad claims about quality, ease, innovation, or business value. Replace them with a supported fact.

Prefer:

- Staff can edit the schedule without changing code.
- Each client uses a separate Firebase project.
- The demo includes six site styles.

## Use simple punctuation

Use full stops for separate facts. Use a colon before an explanation or list. Use parentheses only for brief supporting information.

Do not use a long dash when a full stop, comma, colon, or parentheses is clearer.

## Keep necessary technical terms

Use a technical term only when the reader must identify a setting, file, service, or result. Define it at first use when the audience may not know it.

Do not replace a precise product or platform term with vague wording.

## Scope of the automated check

Run:

```sh
npm run check:copy
```

The check covers current hand-maintained UI, product, demo, email, print, setup, and operator copy. It does not scan tests, generated files, historical plans, architecture records, licenses, legal text, or issue history.

The check blocks a small set of high-confidence promotional phrases, assistant process language, rhetorical frames, design metaphors, filler words, and long dashes. A passing check does not replace human editing.
