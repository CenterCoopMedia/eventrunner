#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function replaceOnce(relativePath, before, after) {
  const file = path.join(ROOT, relativePath);
  const source = fs.readFileSync(file, 'utf8');
  const first = source.indexOf(before);
  if (first === -1) {
    throw new Error(`${relativePath}: expected copy was not found:\n${before}`);
  }
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${relativePath}: expected copy appears more than once:\n${before}`);
  }
  fs.writeFileSync(
    file,
    `${source.slice(0, first)}${after}${source.slice(first + before.length)}`,
  );
}

const demoEdits = [
  [
    "tagline: 'A three-day gathering for the people who keep community media working.',",
    "tagline: 'A three-day event for people who operate local and cooperative newsrooms.',",
  ],
  [
    "        'Three days of sessions, workshops, and hallway conversation for people who run local ' +\n        'and cooperative newsrooms — schedule, speakers, and travel details for the [Demo] Harborlight Media Summit.',",
    "        'Schedule, speaker, workshop, and travel information for the fictional [Demo] Harborlight Media Summit.',",
  ],
  [
    "      'Sessions, workshops, and time to compare notes with people running newsrooms and ' +\n      'stations like yours.',",
    "      'Sessions and workshops for people who operate local and cooperative newsrooms.',",
  ],
  [
    "      '<p>Three days, one track of shared sessions and two of workshops. Day one is welcome and ' +\n      'orientation. Day two is panels and small-group workshops. Day three is unconference ' +\n      'blocks — participants propose the sessions — and a closing conversation about what to ' +\n      'carry home.</p>',",
    "      '<p>The summit has shared sessions and two workshop tracks. Day one includes registration ' +\n      'and orientation. Day two includes panels and workshops. Day three includes ' +\n      'participant-proposed sessions and a closing plenary.</p>',",
  ],
  [
    "    text: 'Small workshop rooms, capped at thirty seats, so there is time for real questions.',",
    "    text: 'Workshop rooms have 30 seats so participants have time for questions.',",
  ],
  [
    "      '<p>A three-day gathering for people who report, edit, and run local and cooperative ' +\n      'newsrooms. It mixes shared sessions with hands-on workshops, and leaves room for the ' +\n      'hallway conversations that usually matter as much as the agenda.</p>',",
    "      '<p>A three-day event for people who report, edit, and operate local and cooperative ' +\n      'newsrooms. The schedule includes shared sessions and practical workshops.</p>',",
  ],
  [
    "    value: '<p>Answers to the questions we hear most before the summit.</p>',",
    "    value: '<p>Answers to common questions about the summit.</p>',",
  ],
  [
    "      '<p>This code of conduct applies to everyone at the Harborlight Media Summit — attendees, ' +\n      'speakers, volunteers, and staff, in every session, workshop, and social space.</p>',",
    "      '<p>This code of conduct applies to attendees, speakers, volunteers, and staff at the ' +\n      'Harborlight Media Summit. It applies in every session, workshop, and social space.</p>',",
  ],
  [
    "    value: '<p>Questions before the summit? Here is how to reach the organizing team.</p>',",
    "    value: '<p>Contact the organizing team before the summit.</p>',",
  ],
  [
    "      '<p>Email <a href=\"mailto:support@example.org\">support@example.org</a> and a member of ' +\n      'the Harborlight team will get back to you within one business day.</p>',",
    "      '<p>Email <a href=\"mailto:support@example.org\">support@example.org</a>. A member of ' +\n      'the Harborlight team will reply within one business day.</p>',",
  ],
  [
    "      'Three newsroom leaders on what it actually takes to keep a shared-coverage partnership ' +\n      'funded past year one.',",
    "      'Three newsroom leaders explain how they fund a shared-coverage partnership after its ' +\n      'first year.',",
  ],
  [
    "      'Building a newsroom budget that bends instead of breaking when one grant does not ' +\n      'renew.',",
    "      'Build a newsroom budget that can absorb the loss of one grant.',",
  ],
  [
    "      'The second half of the audience workshop moves down to the main hall and splits into ' +\n      'small groups — bring a draft survey and leave with it rewritten.',",
    "      'The second half of the audience workshop moves to the main hall for small-group review. ' +\n      'Bring a draft survey. The group will revise it with you.',",
  ],
  [
    "      'Participant-proposed sessions, posted on the board each morning — bring a topic or ' +\n      'just show up.',",
    "      'Participant-proposed sessions are posted each morning. Propose a topic or join a ' +\n      'posted session.',",
  ],
  [
    "      'A short conversation on what came out of the three days and where the network goes ' +\n      'from here.',",
    "      'Review the decisions from the three days and identify the next network actions.',",
  ],
];

for (const [before, after] of demoEdits) {
  replaceOnce('scripts/lib/demo-event.cjs', before, after);
}

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "    'Every style Event Runner ships, what it is for, and what each of its curated',\n    'choices does. This is the prose half of the catalog: The values that render live',\n    'in `packages/shared/src/presetCatalog.cjs`, and the words the theme editor puts',\n    'on screen live in `apps/web/src/admin/presetCopy.js`. All three come from the',\n    'same JSON, so none of them can quietly disagree.',",
  "    'This catalog lists each site style, its default configuration, and the options',\n    'staff can select. Runtime values are in `packages/shared/src/presetCatalog.cjs`.',\n    'Admin labels and explanations are in `apps/web/src/admin/presetCopy.js`.',\n    'All three outputs are generated from the same JSON source files.',",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "    'All six styles are first-class. The order below is the order the style picker',\n    'offers them, which is a recommendation and not a ranking: A fresh deployment',\n    'starts on the first one, and every style ships one recommended configuration —',\n    'the choices marked *recommended* here — that works the moment it is picked.',",
  "    'The picker uses the order shown below. A new deployment starts with Institutional.',\n    'Each style includes one default configuration. Options marked *default* are selected',\n    'when staff choose the style.',",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "    'The narrative behind each style is `docs/plans/2026-08-27-preset-visual-stories.md`.',\n    'The binding rules are `docs/plans/2026-08-27-design-system-overhaul.md`.',",
  "    'Design rationale is in `docs/plans/2026-08-27-preset-visual-stories.md`.',\n    'Implementation requirements are in `docs/plans/2026-08-27-design-system-overhaul.md`.',",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "    if (preset.bestFor) lines.push(`**Best for.** ${preset.bestFor}`, '');",
  "    if (preset.bestFor) lines.push(preset.bestFor, '');",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "      lines.push(`### ${spec.label} — \\`${group}\\``, '');",
  "      lines.push(`### ${spec.label}: \\`${group}\\``, '');",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "        const mark = choice.id === spec.default ? ' *(recommended)*' : '';",
  "        const mark = choice.id === spec.default ? ' *(default)*' : '';",
);

replaceOnce(
  'scripts/build-preset-catalog.cjs',
  "        lines.push(`- **${choice.label}**${mark} — ${choice.why}`);",
  "        lines.push(`- **${choice.label}**${mark}: ${choice.why}`);",
);

console.log('Applied current user-facing copy edits.');
