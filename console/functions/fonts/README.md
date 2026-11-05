# Agreement PDF fonts

`src/agreementPdf.cjs` draws the signer's copy of the agreement with these fonts.

| File | Source | License |
|---|---|---|
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` | Noto Sans 2.015 | SIL Open Font License 1.1 (`OFL-NotoSans.txt`) |
| `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf` | DejaVu Sans 2.37 | Bitstream Vera license, public domain changes (`LICENSE-DejaVuSans.txt`) |

Both families are subset copies, made with fontTools' `subset` module, with these options: no layout features, no hinting, a drawn `.notdef`, and GPOS, GSUB and GDEF dropped.

- **Noto Sans:** Latin through Latin Extended-B, IPA and spacing modifiers, combining marks, Greek, Cyrillic, Latin and Greek Extended, general punctuation, super- and subscripts, currency, letterlike symbols, number forms, arrows, mathematical operators, technical symbols, geometric shapes, miscellaneous symbols, dingbats and the Latin ligatures.
- **DejaVu Sans:** only the characters in those ranges, plus U+2000 to U+2BFF, that Noto Sans lacks, such as "≤" and the arrows.

The fonts are embedded whole, because fontkit's subsetter drops DejaVu Sans glyphs that are drawn in separate calls. The PDF embeds DejaVu Sans only when the text needs one of its characters. Any other character is written as its code point, for example "[U+674E]".
