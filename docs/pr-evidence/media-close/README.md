# Media dialog close control

Local Chromium captures, October 10, 2026, for issue #452's accessible X refinement.
The synthetic harness imports the real ModalShell, generated theme and application
Tailwind CSS. The long title tests wrapping beside the exit control; no production
accounts, content or credentials are used.

At 320, 390, 400 and 1280 CSS px the button measured 54 by 44 CSS px, stayed inside
the viewport and produced no horizontal document overflow. Tab navigation showed
the focus ring pictured here. Enter and Escape dismissed the shell, and focus
returned to its opener. The automated checks used the actual rendered button bounds
and keyboard events, not class-name assertions.

These captures cover the shared component in isolation, not every authenticated
consumer. Physical touch, 200% browser zoom, the complete light/dark consumer matrix
and full application CI remain separate review checks.
