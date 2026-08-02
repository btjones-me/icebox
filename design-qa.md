# Icebox combined header control design QA

Source visual truth: `design-qa/source-combined-header.png`

Implementation screenshot: `design-qa/implementation-combined-header-stage.png`

Focused implementation crop: `design-qa/implementation-combined-header-crop.png`

Viewport and normalization:

- Source crop: 432 × 116 px, showing the previous separate household pill and circular menu control.
- Implementation browser capture: 1280 × 720 px at device scale factor 1.
- Protected iPhone screen rendered at 272.83 × 591.47 CSS px in the in-app preview, a 0.694 stage scale from the 393 × 852 device canvas.
- Focused comparison used the visible header crop from the browser capture and the supplied source crop in the same visual comparison input.
- State: Alder House active; inventory screen loaded; no sheet initially open.

## Full-view comparison

The household identity and hamburger are now contained by one shared white pill in the top-right of the app header. The previous gap and separate dark navy circular button are gone. The brand, search controls, inventory hierarchy, and surrounding spacing remain unchanged.

## Focused comparison

The source establishes the existing home icon, household label, hamburger glyph, cream background, navy type, teal accent, and rounded control language. The implementation deliberately changes only the requested component anatomy: one border, one 44px tap target, a compact divider before the menu glyph, and a single Settings action across the whole control.

## Required fidelity surfaces

- Fonts and typography: the household label keeps the established Roboto weight, size, line height, and navy color; truncation remains available for long household names.
- Spacing and layout rhythm: the combined button is 44px high, uses a 24px radius, and remains aligned to the top-right of the brand row without crowding the Icebox wordmark.
- Colors and visual tokens: white/cream button fill, neutral hairline border, teal home icon, and navy text/menu glyph match the existing clean-ledger palette. The garish standalone dark fill is removed.
- Image quality and assets: no raster assets were introduced. Existing Radix home and hamburger icons are reused consistently.
- Copy and content: `Alder House` is unchanged. The accessible name now reads `Open settings for Alder House`, making the combined behavior explicit.

## Comparison history

1. Initial source finding [P2]: two adjacent controls consumed unnecessary width and visually split one header-level destination into separate objects.
2. Fix: replaced the static household pill plus standalone menu button with one household-and-menu button that opens Settings.
3. Post-fix evidence: the focused source/implementation comparison shows a single compact top-right control with no remaining actionable P0/P1/P2 difference for the requested change.

## Interaction and runtime verification

- The combined button is present once, enabled, and opens the Settings sheet.
- Household switching remains available inside Settings as previously specified.
- Runtime integrity passed, all 14 automated tests passed, the production build succeeded, and the browser console contained no errors.

## Follow-up polish

- No P0/P1/P2 findings remain for this scoped header change.

final result: passed
