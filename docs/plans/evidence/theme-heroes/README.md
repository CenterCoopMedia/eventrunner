# Theme hero verification

Checked the generated, fictional demo on September 11, 2026. These captures
show the accepted transit direction. All six presets were also inspected
separately in light and dark mode at desktop and phone widths.

- [Atlas in daylight](schedule-atlas-light-1440x1000.png)
- [Atlas at night](schedule-atlas-dark-1440x1000.png)
- [Phone schedule with route stops and ticket tabs](atlas-dark-day-two-390x844-full.png)

The browser matrix covered 24 schedule views: six styles, two modes, and
1440px/390px viewports. Every view had its expected loaded hero image, one
Schedule heading, a print control, and no document horizontal overflow.
Home, full-screen entry and exit, focus restoration, retained style/mode/route,
and the More navigation menu were checked separately. Fresh browser console
and page-error logs were empty.

The demo uses synthetic content and disables account features. These checks
do not claim a production sign-in, registration, or CMS write. Client hero
images retain their configured alt text, focal point, and caption; the
illustrations shown here are demo-only assets.
