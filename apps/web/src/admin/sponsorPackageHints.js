// What to write in each part of a sponsor package (#193), shown under the
// field in the block editor. The package draws on the sponsors page, in
// the section the seed names Sponsorship packages.
//
// Its own module, not beside FACT_HINTS in blockTypes.js: blockTypes.js
// rides the admin entry chunk (the section list reads its labels), and
// only the lazily loaded block editor reads these.
export const SPONSOR_PACKAGE_HINTS = Object.freeze({
  name: 'The package’s name. “Presenting”, “Coffee break”.',
  price: 'As it should read, with its currency. Leave it empty to show no price.',
  limit: 'How many sponsors can take this package. Leave it empty for no limit.',
});
