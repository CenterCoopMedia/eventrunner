# Paired event content

`config/event.contentLanguages` is optional. Its shape is
`{ default: 'en' | 'es', available: ['en', ...] }`. Available languages are
unique canonical `en`/`es` keys, include English, and include the default.
An absent setting means English only. Both the shared validator and the
authorized event-config writer validate the complete merged result.
Removing Spanish writes `{ default: 'en', available: ['en'] }`; a live
event without language settings also takes precedence over snapshot settings.

English text lives in the source record's existing fields. A Spanish variant
is `translations: { es: { ...textFields } }` on that same record. The `en`
translation key is rejected because it would create a second English source.
There are no translated record IDs or separate locale records.

| Record | Spanish text fields |
| --- | --- |
| Page | `label`, `title`; built-in pages accept `label` only |
| Page section | `label`, `description` |
| Session | `title`, `description` |
| Text / rich-text block | `value` |
| Image | `alt`, `caption` |
| Call to action | `label` |
| Statistic | `label`, `takeaway`, `description`, `alt` |
| Fact | `label`, `note` |
| Quote / list item | `text` |
| FAQ | `question`, `answer` |
| Link group | `label` |
| Sponsor package | `benefits` |

Other fields keep their meaning in both languages. This includes routes,
section/field keys, block types, URLs, dates and times, parent/day/track/place
references, room names, speaker/organization names, quote attributions,
figures, evidence sources, prices and grouping keys. There is no automatic
translation. Rich-text variants use the source field's HTML sanitizer,
including the same allowed links and removal of unsafe markup.

Each variant is a flat text object. Unknown language/field keys, non-string
values, nested drafts, approval statuses and reviewer metadata are rejected.
Partial Spanish objects can be saved and reviewed. Clearing a page or section
variant omits it from the full page replacement; content/session updates use
the existing whole-field deletion sentinel. Sending a variant map replaces
that complete map; source-only partial updates retain the paired draft map.

The existing staff/operator save and authorized CMS publish action owns both
languages as one reviewed record. Saving writes only the private draft.
Publishing copies the paired public text shape into the live record, version
history and ordinary snapshot path. Publication validates variants again and
sanitizes translated rich text, including restored drafts. No new approval
role, queue, status map or store is involved. Anonymous clients cannot read
drafts or write either revision. Only published text is available to the
public endpoint, Firestore listeners and snapshot generator.

`resolveContentVariant(record, kind, requestedLanguage, eventConfig)` returns
`{ value, language, requestedLanguage, fallback }`. `language` names the actual
source language of that unit. A page name, section heading, complete block,
or session title/description is one coherent fallback unit. Spanish is used
only when it is available and every nonempty translatable English field has
a nonempty Spanish counterpart. Empty rich-text markup does not count. A
partial variant returns the complete English unit without mixing fields.
Resolving one unit does not claim that its surrounding page is fully Spanish.

Live records replace snapshot records in full, so a removed Spanish variant
cannot be revived from an older snapshot. Removing the event locale forces
English resolution even while an older approved Spanish object still exists.
Deleting a record removes both revisions; history remains private under the
existing CMS retention contract.

This contract supplies the paired editor/data model for #552. Public language
choice and its URL rule belong to #553; metadata, exports, transactional-copy
coverage and full bilingual acceptance belong to #554. The default-language
contract does not introduce a second routing rule or change the current public
rendering, dates or transactional templates.
