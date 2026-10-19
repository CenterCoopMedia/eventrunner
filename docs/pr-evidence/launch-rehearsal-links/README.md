# Launch rehearsal: links, page visibility and footer links

Desktop is 1280 × 900. Phone is 390 × 844. Images use a synthetic event, Example Newsroom Summit 2027, seeded fresh by `init-event.cjs`. Before images come from the base commit of this branch. After images come from this branch. Both runs follow the same steps.

The steps are the launch rehearsal for a site that opens with early bird tickets and a session pitch call only:

1. On Settings → Features, switch off **Public schedule**, **Speaker directory**, **Sponsor list**, **Attendee directory** and **Written updates**.
2. On Pages, hide **Recap**.
3. Add a hero button **Explore the program** to `/schedule`, and select **Save and publish**.
4. Open the call for sessions and the ticket catalog.
5. Visit the public pages as a visitor.

## Hero button to a section that is off

- `cta-editor-before-desktop.png`: the editor says nothing about `/schedule`.
- `cta-editor-after-desktop.png`: a warning under **Destination** says the public schedule is off and the site does not show the link. The save still succeeds.
- `cta-home-before-desktop.png` and `cta-dead-end-before-desktop.png`: the home page draws the button, and it leads to "This event doesn't have a public schedule".
- `cta-home-after-desktop.png`: the home page does not draw the button.

## Pages list

- `pages-before-desktop.png`, `pages-before-phone.png`: every row says **Live** and nothing else about the public site.
- `pages-after-desktop.png`, `pages-after-phone.png`: every row says **Visible** or **Hidden**. A built-in page whose feature is off says **Hidden** and names the feature.

## Seeded pages and the home footer links

- `guidelines-before-*.png`: a fresh site shows an empty Guidelines page, linked from the navigation. City guide is the same.
- `guidelines-after-*.png`: a fresh site seeds Guidelines, City guide and Recap hidden, so the address shows the site's 404 page and the navigation does not link it.
- `home-before-*.png`: the home body draws the seeded footer section under a **Footer links** heading, and the site footer does not.
- `home-after-*.png`: the home body has no **Footer links** section. The site footer shows the link under its group name, **About**.

## How to make these

`e2e/launch-links.spec.js` proves the same three results against the E2E fixture. The captures came from the rehearsal's own throwaway spec, which is not committed. Chromium ran without its sandbox, because this capture container runs as root.
