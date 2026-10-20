# Display sizes for uploaded images (#333)

Desktop is 1280 × 900. Phone is 390 × 844. Both runs use the E2E emulator seed. Before images come from the base commit of this branch, `ad0087c`. After images come from this branch. Both runs follow the same steps:

1. An admin uploads a speaker portrait through `speakerPhotoUpload`: `apps/web/public/demo/speakers/elena-santos.webp`, 1254 × 1254, 134,966 bytes.
2. The admin uploads three images to the media library through `mediaUpload`: a sponsor logo, `apps/web/public/demo/sponsors/beacon-community-fund.webp` (2060 × 763, 189,976 bytes); a small 120 × 48 PNG logo (1,440 bytes); and a hero picture, `apps/web/public/hero/broadsheet.webp` (1536 × 1024, 236,900 bytes).
3. The run publishes the speaker, two organizations with those logos, and the home hero image block with the library path of the hero picture.
4. A visitor opens the home page, the speakers page and the sponsors page.

## Bytes the browser downloaded

| Image | Viewport | Before | After |
|---|---|---|---|
| Speaker portrait, speakers page | Phone | 134,966 (original) | 33,588 (`640.webp`) |
| Speaker portrait, speakers page | Desktop | 134,966 (original) | 10,038 (`320.webp`) |
| Sponsor logo, sponsors page | Phone and desktop | 189,976 (original) | 12,650 (`320.webp`) |
| Small logo, sponsors page | Phone and desktop | 1,440 (original) | 706 (`320.webp`, 120 px wide) |
| Home hero | Phone | 0 (no request; the picture did not load) | 48,696 (`640.webp`) |
| Home hero | Desktop | 0 (no request; the picture did not load) | 170,334 (`1280.webp`) |

The same measure on the other repository photos, from `renderImageSizes` (bytes for each width; a width above the original is the original width):

| Fixture | Original | 320 | 640 | 1280 | 1920 |
|---|---|---|---|---|---|
| `demo/speakers/elena-santos.webp`, 1254 × 1254 | 134,966 | 10,038 | 33,588 | 118,050 | 118,050 |
| `demo/speakers/nora-chen.webp`, 1254 × 1254 | 45,096 | 5,532 | 13,868 | 34,876 | 34,876 |
| `demo/sponsors/beacon-community-fund.webp`, 2060 × 763 | 189,976 | 12,650 | 32,254 | 82,024 | 146,190 |
| `hero/broadsheet.webp`, 1536 × 1024 | 236,900 | 13,094 | 48,696 | 170,334 | 252,880 |
| `hero/nclocal-summit.jpg`, 950 × 535 | 89,195 | 11,000 | 29,268 | 54,208 | 54,208 |

One case is larger: `broadsheet.webp` at full width is 7% larger than the upload, because the upload was already a tuned WebP. A browser only asks for that file for a slot wider than 1280 device pixels.

## Screenshots

- `speaker-before-*.png`, `speaker-after-*.png`: the speaker plate. The picture is the same at both widths. After, it is the 640 or 320 px WebP copy.
- `sponsors-before-*.png`, `sponsors-after-*.png`: the sponsor wall. The large logo looks the same. The small logo was drawn at its own 120 px before. After, it fills its mark box, as every larger logo already did.
- `hero-before-*.png`, `hero-after-*.png`: the home hero with a picture picked from the media library. Before, the block's object path was a relative link to a page on the site, so the picture did not load. After, it loads from Storage, with display sizes.
