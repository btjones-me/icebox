# Icebox WhatsApp feedback: ranked PRDs

**Research window:** 13 July–11 August 2026

**Source:** supplied WhatsApp export, including the three Icebox screenshots shared on 5 August 2026

**Code baseline reviewed:** `main` at `5a2c859`

**Status:** product planning only; no feature implementation is authorised by this document

## Executive read

All Icebox feedback in the 30-day window occurred on 5 August. It came from one person who catalogued and photographed a real freezer drawer, plus one additional person who made a specific photo-viewing request. This is useful early-alpha evidence, but it is not broad validation.

The strongest findings are that photos need to work better as identification tools: users should be able to open a photo at useful size, and thumbnail presentation should be consistent on Android and iPhone. The most strategically important observation is that cataloguing one drawer took about 30 minutes. That is not an explicit complaint, but it exposes friction in Icebox's core setup job and merits measurement plus a thin rapid-entry improvement.

Sorting, printing, iconography and sign-in were originally submitted through Icebox's feedback form. The actual form payload is not present in the WhatsApp export; those topics can only be reconstructed from the product owner's replies. Their exact problem statements must therefore remain provisional.

Current Icebox already covers some of the feedback: personal households and server-side isolation exist; three sort modes exist as a household-wide flat view; app, favicon and home-screen icons exist; and sign-in persistence is owned by Sites' Sign in with ChatGPT session. Printing, photo enlargement, scoped sorting and repeated-entry mode are not implemented.

## Evidence and ranking method

Names have been omitted because identity is not relevant to the product decisions.

| Evidence | What it supports |
| --- | --- |
| Tester A reported spending roughly 30 minutes itemising and photographing one kitchen-freezer drawer. | Real behavioural evidence that initial capture may be slow. The tester called the activity fun, so this is friction rather than a confirmed failure. |
| The product owner replied separately to “Sort”, “icon”, “Print”, “Photos” and “Sign in”. | Those topics were in the missing in-app report, but their exact wording, context and requested outcomes are unknown. |
| Tester A later said photos seemed off-centre, then shared an Android screenshot and said they looked small with excess space above. | Direct, device-specific photo-presentation evidence. The tester also said it was “not a big deal”, reducing urgency. |
| Tester B explicitly asked to tap a photo to enlarge it; the product owner agreed. | Direct validation for an image viewer. |
| The product owner clarified that the current household was a test household and that users would create their own households for V1. | Possible confusion about ownership/test data, but not a preserved direct complaint. |
| The tester jokingly asked what to charge other users after testing. | Positive enthusiasm, not pricing evidence or demonstrated willingness to pay. |

Validity scores combine directness of evidence, relevance to Icebox's core job, severity, corroboration, appropriateness of the proposed solution and implementation confidence. They are not estimates of commercial value.

| Rank | Feedback item | Validity | Product decision | Current status |
| ---: | --- | ---: | --- | --- |
| 1 | Tap a photo to enlarge it | **9.0/10** | Implement | Missing |
| 2 | Android photo sizing/alignment | **8.5/10** | Reproduce, then fix | Shared component exists; cross-platform issue remains unverified |
| 3 | One drawer took about 30 minutes to capture | **8.0/10** | Measure, then implement a thin rapid-entry flow | Missing |
| 4 | Personal household rather than shared test data | **8.0/10** | Treat as a core regression requirement | Substantially implemented |
| 5 | Sort at different hierarchy levels | **7.5/10** | Reframe as scoped flat results | Household-wide flat sorting exists; scope is missing |
| 6 | Sign-in should persist | **6.0/10** | Diagnose before changing anything | Platform-owned session flow exists |
| 7 | Print the inventory | **5.0/10** | Clarify the job; cheap MVP if confirmed | Missing |
| 8 | “Work on the icon” | **3.0/10** | Do not implement without identifying the icon/problem | App and freezer icon systems already exist |

## Recommended sequence

1. Build the photo viewer and reproduce the Android photo issue together, because they share the same component and acceptance testing.
2. Instrument item-entry duration, then ship **Save and add another** as the smallest credible response to the 30-minute drawer setup.
3. Verify the personal-household and sign-in flows with fresh accounts and installed PWAs rather than adding new authentication or ownership systems.
4. If scoped sorting is still wanted, add scope to the existing flat results view; do not reorder the freezer hierarchy.
5. Clarify the print job and the unidentified icon before scheduling either.

---

## PRD 1 — Inventory photo viewer

### Decision

**Implement.** This is the clearest request in the source, directly supports item identification and is modest in scope.

### Problem

Inventory thumbnails are intentionally small and cropped. For packaging with similar colours, small labels, freezer bags or unclear contents, a thumbnail is not enough to confirm what the item is. The current behaviour opens the item editor rather than providing a photo inspection action.

### User and job

A household member browsing a drawer wants to inspect an item's saved photo quickly, without entering edit mode or risking an accidental change.

### Goals

- Make a saved inventory photo useful for visual identification.
- Preserve the existing fast path from the row body to editing.
- Work consistently in mobile Safari, installed iOS PWA, Android Chrome/PWA and desktop browsers.
- Keep private media protected by the existing household-membership check.

### Non-goals

- Editing, cropping or annotating the photo.
- An image gallery or history of old photos.
- Downloading or sharing a private inventory image.
- Building custom image-zoom physics when native gestures suffice.

### Product requirements

- A photographed item's thumbnail is an explicit **View photo** target.
- Tapping the thumbnail opens a full-viewport accessible viewer.
- The entire image is visible using a contained fit rather than the cropped list treatment.
- The viewer shows the item label and a conventional Back/Close control.
- Escape, browser Back and the viewer's close control dismiss it predictably.
- Pinch zoom remains available on touch devices. Icebox must not disable browser zoom.
- Tapping the rest of the row still opens the editor.
- An initials tile is non-interactive and never opens an empty viewer.
- A failed image load falls back to a clear unavailable state, without exposing storage keys or technical errors.

### Acceptance criteria

1. From drawer contents and flat search/sort results, tapping a real photo opens the viewer.
2. The uncropped image is contained within the real viewport and safe areas.
3. Back, Close, Escape and browser Back return to the same inventory scroll position.
4. The row's label/body still opens Edit item.
5. Items without photos retain their deterministic initials tile and expose no viewer action.
6. A user without household membership cannot fetch the image even with its ID.
7. Screen readers announce “View photo of {label}” and focus returns to the originating thumbnail after close.
8. Swipe-to-delete remains direction-locked and functional after the row is restructured.

### Technical implementation plan

**Frontend structure**

- In `src/Prototype.tsx`, add app-owned `photoViewerItem` state and a focused `InventoryPhotoViewer` component.
- Refactor `ItemRow` from one button containing the thumbnail into a row container with two sibling controls:
  - a thumbnail button for items with a real image;
  - a main row button for editing.
- Do not nest a button inside the existing row button; that would be invalid HTML and unreliable for keyboard users.
- Reuse the existing `imageUrl` returned from the authorised `/api/media/:id` route. Do not expose R2 object keys or create public URLs.
- Render the viewer through the existing accessible dialog primitives or an equivalent app-owned full-screen dialog. A photo viewer is not an item-edit bottom sheet.
- Use `object-fit: contain`, an explicit image loading state and a close control clear of mobile safe areas.
- Keep `touch-action` compatible with native pinch zoom; do not intercept two-finger gestures.

**Styling**

- Add the viewer, scrim, contained-image and responsive action styles to `src/prototype.css`.
- Keep the list thumbnail treatment unchanged here; PRD 2 owns its dimensions and crop.

**Backend and data**

- No D1 schema or API change is needed.
- Retain the existing membership-authorised media delivery path.
- Do not add image bytes to bootstrap or client telemetry.

**Testing**

- Add browser tests in `tests/pwa-shell.spec.ts` for drawer, search and sorted-result entry points; photo/no-photo behaviour; close methods; focus restoration; failed image; and swipe-delete regression.
- Add an integration assertion that `/api/media/:id` still denies a non-member.
- Run mobile acceptance at representative iPhone and Pixel viewport sizes, plus keyboard-only desktop navigation.

### Success measures

- At least 95% of viewer opens display the image without a client error.
- Viewer open-to-close produces no item mutation.
- Follow-up testers can identify visually ambiguous items without entering Edit item.

### Risks

- Splitting the row into sibling controls can reduce the edit hit area unless the main button remains full-height.
- Browser Back handling must not navigate away from Icebox when it should only close the viewer.

---

## PRD 2 — Consistent cross-platform inventory thumbnails

### Decision

**Reproduce, then fix.** The Android screenshot and direct report validate a presentation problem, but the screenshot alone does not prove whether the whitespace comes from CSS, source-photo composition, device scaling or an older deployed build.

### Problem

The same inventory can feel materially less scannable on Android when photos look smaller, off-centre or surrounded by excess whitespace. Photos are a key recognition aid, so inconsistent treatment undermines the promise that the PWA works equally well across iOS and Android.

### Goals

- Use one predictable thumbnail frame across drawer rows, search results and editor previews.
- Make thumbnails large enough to recognise without making the inventory list claustrophobic.
- Normalize layout, crop and alignment across supported viewports and font scaling.
- Diagnose the real cause before changing dimensions globally.

### Non-goals

- Per-image manual focal points in V1.
- AI subject detection or smart cropping.
- Switching list thumbnails to `contain`, which would reintroduce inconsistent letterboxing.
- User-agent-specific CSS.

### Product requirements

- Photo and initials thumbnails use the same explicit square frame.
- List photos use the established cropped treatment: `object-fit: cover` and centred positioning.
- Intrinsic image dimensions, EXIF orientation and image baselines cannot alter row geometry.
- Thumbnail size scales only through a shared responsive token, not browser sniffing.
- Row text and chevrons remain aligned with Android font scaling and browser zoom.
- If a source photo itself contains empty space, Icebox does not pretend a CSS crop can always fix it; the photo viewer provides the detailed inspection path.

### Acceptance criteria

1. The same fixture inventory renders equivalent thumbnail frame sizes and alignment at agreed iPhone and Pixel CSS viewports.
2. All list images fill the shared square frame, remain centred and never distort.
3. Initials tiles exactly match photo dimensions.
4. Row height, text wrapping and swipe-delete remain stable at 100%, 125% and 150% text scaling.
5. Portrait, landscape, metadata-bearing JPEG, PNG, WebP and converted HEIC fixtures render with correct orientation.
6. No photo or thumbnail overflows the row at narrow widths.
7. A screenshot comparison confirms that the reported Android layout is improved rather than merely different.

### Technical implementation plan

**Reproduction first**

- Recreate the attached Android viewport and inventory density using the actual screenshot dimensions and representative portrait/landscape source images.
- Compare computed `.item-thumbnail`, `.item-row` and image dimensions against the iPhone fixtures.
- Confirm that the running build and service worker are current before attributing the screenshot to source code.

**Frontend changes after reproduction**

- Keep `ItemThumbnail` as the single implementation in `src/Prototype.tsx`.
- In `src/prototype.css`, define shared thumbnail and row-size custom properties instead of disconnected literal sizes.
- Give the frame explicit inline size, block size, `aspect-ratio: 1`, `flex: none`, overflow clipping and a stable radius.
- Give the image `display: block`, `inline-size: 100%`, `block-size: 100%`, `object-fit: cover` and `object-position: 50% 50%` to eliminate baseline/inherited-size surprises.
- If reproduction confirms that 55px is disproportionately small at common Android widths, introduce a restrained responsive size such as a 55–64px `clamp()` and adjust row grid/min-height from the same token.
- Do not change the photo upload API or add per-device branches.

**Backend and data**

- No schema/API work is expected. `src/image-processing.ts` already normalizes orientation and re-encodes supported inventory images; retain that pipeline.

**Testing**

- Add computed-size and overflow assertions for both photo and initials thumbnails in `tests/pwa-shell.spec.ts`.
- Add visual fixtures for iPhone and Pixel widths covering drawer, flat results and editor preview.
- Include a source image with intentional whitespace so the team does not mistake source composition for a layout regression.

### Success measures

- No device-specific thumbnail complaints in the next alpha round.
- Visual regression images show equivalent hierarchy and density across iPhone and Pixel viewports.

### Risks

- Enlarging all thumbnails can reduce the number of visible items and make the hierarchy feel denser.
- Aggressive cropping may hide important package text; PRD 1 is the safer solution for detailed inspection.

---

## PRD 3 — Rapid repeated item entry

### Decision

**Measure immediately, then implement a thin repeated-entry flow.** Do not jump to barcode scanning, OCR, bulk import or multi-photo AI from one positive but time-consuming session.

### Problem

Cataloguing and photographing one drawer took about 30 minutes. A household may have several freezers and dozens of items, so a lengthy first inventory creates a large activation barrier even if each individual form is understandable.

### User and job

A household member setting up an existing freezer wants to record many items in the same drawer with minimal repeated navigation and location entry.

### Goals

- Reduce repeated taps and sheet transitions between consecutive items.
- Preserve the current item-level validation, photo upload guarantees and AI-label safety.
- Establish a privacy-safe baseline for time per completed item.
- Keep ordinary one-off item creation simple.

### Non-goals

- Barcode databases, receipt import or spreadsheet import.
- Multiple items inferred from one freezer photograph.
- Offline writes.
- Parallel unsaved drafts.
- Automatically carrying expiry, notes or a manually changed frozen date to another item.

### Product requirements

- The add sheet offers **Add to freezer** and **Save and add another**.
- **Save and add another** saves the current item, then opens a clean draft in the same freezer and drawer.
- The new draft resets label, photo, notes and expiry and restores Frozen on to the current local date.
- Location remains visible and editable; the user is never trapped in rapid mode.
- The next draft appears only after the previous save has succeeded. A failed save retains the current values and explains the error.
- Closing the sheet ends the repeated-entry session without affecting completed items.
- Automatic label generation continues to run only for a blank label and cannot write into the next draft after reset.
- Privacy-safe telemetry records session start, completed-item count, duration, save failure and exit, but never label, notes, photo or search text.

### Acceptance criteria

1. A user can add ten items to one drawer without returning to the inventory between items.
2. Freezer and drawer persist; all item-specific fields reset correctly.
3. Save failure leaves the entered item intact and does not create the next draft.
4. Each successful item is independently persisted and appears in bootstrap after reload.
5. An AI response from the previous item cannot overwrite the next item's label.
6. Normal **Add to freezer** retains its existing close-and-return behaviour.
7. Offline mode remains read-only.
8. After a baseline is established, the median active time per repeated item falls by at least 30% in tester sessions.

### Technical implementation plan

**Instrumentation baseline**

- Use the existing sanitized event transport in `src/telemetry.ts` and generic `app_events` storage.
- Add event names for add-sheet opened, item save succeeded/failed, rapid next started and rapid session exited, with duration/count/location IDs only where allowed by current privacy rules.
- Collect at least several real drawer sessions before considering a larger capture redesign.

**Frontend flow**

- In `src/Prototype.tsx`, change `saveItem()` to accept a completion mode such as `close` or `continue` and return a success result.
- For `continue`, serialize saves: keep the sheet open and disable both actions until the API confirms success.
- After success, invalidate the old label-generation request, revoke old blob previews, and call `emptyDraft()` with the same freezer/drawer.
- Add the secondary repeated-entry action to `ItemForm`. Keep **Add to freezer** visually primary unless testing shows repeated entry is the dominant setup task.
- Preserve current photo behaviour: a photo is attached only after `/api/media` succeeds, and an existing label is not overwritten.

**Backend and data**

- Reuse the existing item and media APIs; no schema migration is required.
- Do not create a bulk endpoint until measurement shows request overhead is material. Serialized single-item writes preserve validation, outbox and recovery semantics.

**Testing**

- Add browser tests for two or more consecutive photo/manual items, field reset rules, preserved location, failed second save, AI race cancellation, close/exit and reload persistence.
- Extend telemetry validation tests to ensure no inventory content enters event metadata.

### Success measures

- Median time and tap count per item in repeated sessions.
- Percentage of users completing a second item after the first.
- Save/error abandonment rate.
- Qualitative tester response after cataloguing a whole drawer, not one isolated item.

### Risks

- Persisting the wrong fields can silently duplicate inaccurate dates or notes.
- Optimistic concurrent saves would complicate rollback; the first version should serialize repeated entry.

---

## PRD 4 — Personal household induction and isolation

### Decision

**Treat as a core regression requirement, not a new feature build.** Current Icebox already creates and switches households and enforces membership server-side. The useful work is verifying that a fresh external user never experiences the shared test-household confusion.

### Problem

An alpha tester may not know whether the visible household is temporary, personal or shared. More importantly, no user should ever see demo or another household's data simply because they have authenticated.

### Goals

- Make first-login ownership and sharing state obvious.
- Keep household data isolated by stable authenticated identity and membership.
- Ensure invitations take precedence over unnecessary induction.
- Prevent any demo-data flash during bootstrap.

### Non-goals

- A separate sandbox/demo mode in production.
- Automatically copying one household's inventory to another.
- Changing the established limits or ownership model.

### Product requirements

- A newly admitted user with no membership sees household induction.
- A user with a pending invitation sees the invitation before induction.
- Creating a household makes the current stable ChatGPT user its owner.
- Settings clearly distinguishes household switching/creation from freezer setup.
- Shared household membership never implies ownership.
- The authenticated loading state is neutral and branded; seeded demo data is never rendered first.
- Moving alpha test items into a user's new household is an explicit operator migration, not an automatic cross-household copy.

### Acceptance criteria

1. A fresh admitted account with no membership sees induction and no inventory API data.
2. An invited fresh account can accept and enter the invited household without creating a duplicate household.
3. A user can create and switch households within current limits.
4. Every household, item, media and member API denies a non-member regardless of client-supplied IDs.
5. Sign-out, identity mismatch and admission denial clear user-specific cached inventory.
6. No demo household or stale previous-account inventory appears during loading.

### Technical implementation plan

- Treat the current flows in `src/Prototype.tsx`, `src/AuthGate.tsx`, `worker/lib/auth.js` and `worker/lib/db.js` as the implementation baseline.
- Add fresh-account, invitation-first, owner/member, household-limit, cross-household IDOR and cache-isolation acceptance tests.
- Verify that all media access begins with membership lookup and that current household defaults are cleared when membership is removed.
- If testing shows ownership confusion, add restrained contextual copy such as **Owned by you** or **Shared household** in the household chooser using existing owner metadata; do not create new roles.
- Keep production free of a demo household. Local seed data remains development-only and must stay behind the branded bootstrap state.

### Success measures

- Zero cross-household access test failures.
- Fresh testers can correctly state whether a household is theirs or shared.
- No feedback reports about seeing test or another user's data.

---

## PRD 5 — Scoped inventory discovery

### Decision

**Reframe the solution.** The underlying findability need is credible, but independently sorting nested freezer/drawer rows would destabilize the location hierarchy and conflicts with Icebox's established sort model. Add scope to the temporary flat results view instead.

### Problem

The existing sort modes operate across the whole household. A user looking at one crowded drawer or one freezer may want alphabetical, expiry or added-date results only for that context.

### Goals

- Let users narrow sorting to household, freezer or drawer.
- Preserve freezer/drawer structure and ordering.
- Keep every result's physical location visible.

### Non-goals

- Persistently reordering items inside drawers.
- Drag-and-drop ordering.
- Reordering freezers or drawers through Sort.
- Server-side sorting for the current household-size limits.

### Product requirements

- Sort remains a temporary flat list.
- The sort sheet offers a scope: whole household, current freezer, or current drawer when context exists.
- Sort choices remain Expiring soonest, Alphabetical and Added date.
- Every result shows both freezer and drawer.
- Items without expiry appear last when sorting by expiry.
- **Done** clears the temporary view and returns to the unchanged hierarchy and accordion state.
- Switching household resets an invalid scope safely.

### Acceptance criteria

1. Household scope reproduces current behaviour.
2. Freezer scope contains only items in the selected freezer.
3. Drawer scope contains only items in the selected drawer.
4. Scope composes correctly with all three sort modes and search.
5. Results never mutate freezer, drawer or item persistence order.
6. If no current drawer exists, the UI does not offer a misleading drawer scope.
7. Returning to Default freezer view restores the prior hierarchy state.

### Technical implementation plan

- Add an `InventoryScope` type and stable-ID scope payload in `src/inventory-sort.ts`.
- Extend `selectInventoryResults()` to filter by household freezer IDs plus optional freezer/drawer ID before sorting.
- In `src/Prototype.tsx`, add transient scope state and scope controls to the existing sort sheet.
- Derive contextual labels from stable IDs, not user-editable names.
- Reset scope on household change or deleted/moved structure.
- Continue using client-side derived results; bootstrap already contains the required active-household inventory.
- Add unit tests for scope isolation, invalid IDs and search/sort composition, plus browser tests for contextual choices, Done/reset and location labels.
- If this direction is approved for implementation, update the durable sorting decision in `AGENTS.md`, which currently specifies household-wide results.

### Success measures

- Users find an item in a crowded freezer/drawer without scanning unrelated locations.
- No increase in “where did the hierarchy go?” feedback after entering a sorted view.

### Risks

- Too many controls in the sort sheet could exceed short mobile viewports; retain its scrollable safe-area behaviour.
- “Current drawer” is ambiguous when every drawer is closed; omit it rather than guessing.

---

## PRD 6 — Predictable authenticated return

### Decision

**Diagnose before building.** There is no direct report of repeated prompts in the WhatsApp source, and Sites owns the ChatGPT session lifetime. Icebox must not add its own password, refresh token or persistent authentication cookie.

### Problem

If a user is unexpectedly asked to sign in again after recently using Icebox, the installed PWA can feel unreliable. Conversely, treating expired or changed identity as still authenticated would expose private household data.

### Goals

- Reuse a valid Sites session without unnecessary prompts.
- Make legitimate expiry or account switching predictable.
- Preserve strict identity-bound cache behaviour.
- Produce enough privacy-safe diagnostics to distinguish platform expiry from network or admission failure.

### Non-goals

- Extending or overriding ChatGPT/Sites cookie lifetime.
- App passwords, “remember me”, refresh tokens or custom authentication.
- Treating cached inventory as proof of authentication.

### Product requirements

- A reload or relaunch during a valid Sites session opens Icebox without another sign-in interaction.
- An expired session returns through dispatch-owned Sign in with ChatGPT.
- Reauthentication returns to the intended safe Icebox route where supported.
- Sign-out clears private in-memory and device cache state.
- Offline inventory opens only for the exact previously authenticated identity.
- The UI distinguishes authentication, invite/admission and connectivity failures.

### Acceptance criteria

1. Signed-in reload and normal PWA relaunch succeed while the Sites session is valid.
2. Explicit sign-out requires authentication on the next online visit.
3. Account switching cannot reveal another user's cached inventory.
4. An expired session never falls through to demo or unkeyed offline inventory.
5. Diagnostics identify display mode, auth-gate outcome and connectivity state without recording cookies, headers or full private content.

### Technical implementation plan

- Test the canonical production or staging Site on Safari browser, installed iOS PWA, Chrome Android, installed Android PWA and desktop across reload, process close/reopen and expected expiry.
- Retain `src/AuthGate.tsx` calling `/api/session` with same-origin credentials; Sites continues to own identity headers and cookies.
- If a reproducible app-controlled issue exists, tighten `return_to`, session response handling and exact-user offline cache keys. Do not persist identity tokens in local storage.
- Add privacy-safe auth-gate telemetry states and correlate with feedback references.
- Keep automated tests for repeated admitted reload, malformed response, offline detection, sign-out cache clear and service-worker auth-route bypass. True cookie longevity requires production/staging acceptance because local mocks cannot reproduce dispatcher policy.
- Escalate verified platform session loss as a Sites issue rather than masking it in Icebox.

### Success measures

- No unexplained repeat-login feedback within the expected Sites session window.
- Zero cache disclosure across account changes.

---

## PRD 7 — Print-friendly inventory snapshot

### Decision

**Clarify the job before scheduling.** A browser-print MVP is inexpensive, but printed freezer inventories become stale. The original request may actually mean paper for the freezer door, Save as PDF, CSV export, sharing or disaster recovery.

### Problem

Some household members may want an at-a-glance paper list or portable snapshot without opening Icebox. The exact context is missing from the source.

### Discovery questions

- Is the intended output paper on the freezer door, a PDF, a spreadsheet or a shareable list?
- Should the scope be a drawer, freezer or whole household?
- Are notes and dates useful, or is a compact label/location checklist the real need?
- How will users know the print is stale after inventory changes?

### Goals if validated

- Produce a legible snapshot using native browser Print/Save as PDF.
- Make scope, household and generation time explicit.
- Avoid exposing private photos by default.

### Non-goals

- A server-side PDF service.
- Scheduled printing or email delivery.
- Treating print as the disaster-recovery backup.
- Two-way import from printed/CSV output.

### Product requirements

- A Settings action opens print options for household, freezer or drawer.
- The snapshot groups items by freezer and drawer and includes label, frozen date and expiry.
- Notes are optional; photos are excluded by default for privacy and ink usage.
- Household name and a prominent “Generated {date/time}” marker appear on every document.
- Empty structures are omitted unless explicitly requested.
- Page breaks avoid separating a freezer/drawer heading from its first item.
- The output is generated from the active household only.

### Acceptance criteria

1. Browser Print and Save as PDF produce a readable A4 and US Letter layout.
2. App chrome, action buttons, sheets and navigation do not print.
3. Printed data contains no item from another household.
4. Long labels and notes wrap without clipping.
5. Photos are absent by default and can only be included through an explicit choice if that option is later validated.
6. Canceling Print returns to the same app state.

### Technical implementation plan

- Add a pure helper such as `src/inventory-print.ts` to select and group active-household items by stable freezer/drawer positions.
- Add a Settings row and print-options sheet in `src/Prototype.tsx`.
- Render a semantic print-only section from already-authorised bootstrap data, then call `window.print()`.
- Add focused `@media print` rules to `src/prototype.css`; avoid a PDF dependency and backend endpoint.
- Unit-test grouping/scope and active-household exclusion. Browser-test the Settings entry, mocked `window.print()` and print-media visibility.
- If CSV is later chosen instead, create a separate explicit export and neutralize values beginning with `=`, `+`, `-` or `@` to prevent spreadsheet-formula injection.

### Success measures

- Users can produce the intended output without manual copy/paste.
- Follow-up use confirms printing is recurring rather than a one-off request.

### Risks

- A stale printout can be less trustworthy than the app; generation time must be conspicuous.
- Shared printers and PDFs can leak household inventory details.

---

## PRD 8 — Icon clarity verification

### Decision

**Do not implement yet.** The source does not identify the icon, screen, action or problem. Current Icebox already has favicon, Apple touch, 192px/512px PWA icons and an upright-freezer hierarchy icon.

### Problem

Unknown. Plausible interpretations include launcher appearance, favicon, freezer-row icon, action recognition, size or styling. Choosing one would manufacture evidence.

### Discovery requirement

Obtain the original in-app feedback report or ask the tester to point to the icon in a screenshot and describe what they expected it to communicate.

### Acceptance gate

No implementation starts until the team can answer:

1. Which exact icon and screen?
2. Is the problem recognition, visual style, size, contrast, safe-zone cropping or accessibility?
3. What action or object should a first-time user identify?
4. Is the issue still present in the current installed build after reinstalling, given launcher icon caching?

### Technical options after clarification

- **PWA/home-screen icon:** review `public/manifest.webmanifest`, `public/icons/*`, `index.html` and `public/sw.js`; if Android maskable cropping is the issue, split `any` and true maskable assets with correct safe-zone padding, version the files, bump the shell cache and device-test after reinstall.
- **Freezer hierarchy icon:** verify the existing `public/icons/upright-freezer.svg` against the clean-ledger design and accessible surrounding label.
- **Action icon:** prefer the established Radix icon set and retain a visible label or accessible name for any non-obvious action.

### Testing

- Installed-icon QA on representative iPhone and Pixel devices if launcher branding is implicated.
- A comprehension check in which the intended user identifies the icon/action without prompting.
- Existing packaging tests continue to verify that required icon assets ship.

### Success measure

The tester can identify the object/action correctly without explanation, and the change addresses the named issue rather than an inferred one.

---

## Signals deliberately not converted into PRDs

### Pricing

“How much do we charge other users?” was written jokingly after testing. It is a positive enthusiasm signal, but it does not establish willingness to pay, target customer, pricing unit or purchase authority. Pricing work should begin with explicit problem/value interviews and usage retention, not this message.

### Duplicate-looking items and unusual dates in screenshots

The screenshots contain visually similar labels and dates that could prompt future research into quantities, duplicate detection or date entry. Nobody raised them as problems. Turning them into requirements would be speculation.

## Research gaps

- Retrieve the in-app feedback report referenced at 15:37 on 5 August. It is the only reliable way to recover the original wording behind sort, icon, print, photos and sign-in.
- Observe at least three more households cataloguing a real drawer and record privacy-safe completion times before investing beyond **Save and add another**.
- Reproduce the Android photo issue on the current build and distinguish app layout from source-photo composition.
- Ask what “print” is intended to accomplish before selecting paper, PDF or CSV.
