import { FACT_HINTS, STAT_CONTRACT_HINTS } from './blockTypes.js';
import { SPONSOR_PACKAGE_HINTS } from './sponsorPackageHints.js';

const FIELD_HINTS = Object.freeze({
  text: { value: 'Write the text attendees should see in this part of the page.' },
  richtext: { value: 'Write the page text and use the toolbar to add headings, lists or links.' },
  image: {
    url: 'Choose or upload the picture for this content block.',
    alt: 'Describe the picture for people who cannot see it.',
    caption: 'Add a short caption displayed with the picture.',
    focalX: 'Choose the part of the picture to keep across a crop: 0 is the left edge and 100 is the right.',
    focalY: 'Choose the part of the picture to keep down a crop: 0 is the top edge and 100 is the bottom.',
  },
  map: {
    useEventVenue: 'Use the venue name, address and map link saved in Event settings.',
    embedUrl: 'In Google Maps, choose Share, then Embed a map. Paste the copied HTML or its embed link.',
    label: 'Describe what the map shows, such as “Map of the convention center”.',
    address: 'Show a street address below the map. A map that uses the event venue shows its saved address when this is blank.',
  },
  cta: {
    label: 'Write the short action phrase shown on the button or link.',
    url: 'Enter a full web address that starts with https://, or a page on this site such as /travel.',
    external: 'Open this link in a new tab when it leads away from the event site.',
  },
  stat: STAT_CONTRACT_HINTS,
  fact: FACT_HINTS,
  quote: { text: 'Use the speaker’s exact words, without quotation marks.', attribution: 'Who said it, and in what role.' },
  sponsor_package: { ...SPONSOR_PACKAGE_HINTS, benefits: 'Describe what sponsors receive with this package. Use the toolbar for a list of benefits.' },
  list_item: { text: 'Write one entry in this page’s list.' },
  faq_item: {
    question: 'Write the question attendees are likely to ask.',
    answer: 'Answer the question in plain language. Use the toolbar for links or lists.',
  },
  link_group: {
    group: 'Name the group this link belongs under.',
    label: 'Write the text attendees should select to open the link.',
    url: 'Enter a full web address that starts with https://, or a page on this site such as /travel.',
  },
});

export function contentFieldHelp(blockTypeId, fieldId) {
  return FIELD_HINTS[blockTypeId]?.[fieldId];
}
