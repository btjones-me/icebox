# Icebox PWA Agent Guide

## Version Control

- Make a local checkpoint commit after each coherent feature or fix and before starting unrelated work.
- Stage only files relevant to that checkpoint. Never commit `.env`, `.local/`, dependencies, or generated build output.
- Do not push, publish, or deploy without explicit user approval.

## Canonical Production Site

- The canonical production URL is `https://ice-box.xyz`. Use this hostname for all user-facing links, admin access, feedback review, production smoke tests, and operational checks.
- The canonical Sites project is the project recorded in `.openai/hosting.json`. Do not replace its `project_id` based on a title, slug, or legacy hostname.
- Treat Sites-generated `*.chatgpt.site` URLs as non-canonical infrastructure aliases. Do not use them to validate production data or report deployment status when `ice-box.xyz` is available.
- The legacy standalone Icebox projects `icebox-btj-4h2k9` and `icebox-freezer-btjones` are retired. Do not recreate, deploy to, link to, or use them as data sources.

## Staging Site

- The isolated staging URL is `https://icebox-staging.btjones-me.chatgpt.site`. Its Sites project ID is `appgprj_6a711eb46e5481919a05b2ccd2a3bee8`; production remains `appgprj_6a6ebffe587c8191ac31960e7909541a` at `https://ice-box.xyz`.
- The staging checkout is `/Users/benjaminjones/repos/icebox-staging` on branch `staging/icebox`. Keep staging work isolated there and do not replace the production project ID in the main checkout.
- Sites gives each project separate D1 and R2 bindings, and Sign in with ChatGPT user IDs are scoped to a Site. Staging therefore sets `OPERATOR_CHATGPT_EMAIL` and `STAGING_IDENTITY_BY_EMAIL=1` so authenticated emails can map to snapshot users and household permissions. Never set `STAGING_IDENTITY_BY_EMAIL` in production; production continues to authorize by the stable production ChatGPT user ID.
- `migrations/0008_staging_snapshot.sql` and `drizzle/0008_staging_snapshot.sql` are staging-only snapshot migrations. Never apply or merge them into production. When promoting an approved staging change, merge or cherry-pick only the product code and tests, excluding staging hosting metadata, staging environment settings, and the snapshot migrations.
- The Sites connector currently has no raw D1/R2 export-import operation. A staging data refresh is therefore a functional snapshot of current households, structures, inventory, memberships, invitations, and allowlist state, with any required media copied separately. It is not a byte-for-byte clone and does not include production telemetry, feedback reports, logs, backup outbox history, or unrecoverable tombstones.
- The staging Site uses public Site access so invited external testers can reach the shell, while Icebox itself still enforces Sign in with ChatGPT and server-side admission. Treat staging data as private and non-production despite the public shell.
- Staging deployment and production promotion are separate approvals. A request to deploy or refresh staging does not authorize any change to `ice-box.xyz`; deploy production only after the user explicitly approves promotion.

## Prototype Instructions

Production Icebox is a native responsive PWA. It fills the real browser or installed-app viewport on mobile, tablet, and desktop; it never renders device bezels, a device picker, a fake status bar, a fake home indicator, a simulated keyboard, a custom cursor, or a scaled phone canvas. The phone simulator is development-only and may be enabled explicitly for runtime regression fixtures or a local `?simulator=1` preview.

In ChatGPT Work Mode, run `sites-preview start "$PWD"`, open `http://terminal.local:4173/` in the cloud browser, and verify the rendered app and its primary interactions. Keep that preview open and tell the user to inspect it in the cloud browser; do not present the local URL as a user-facing chat link. In Codex Desktop, run the local server yourself, open the preview in the in-app browser, and provide the clickable local URL. Do not deploy to Sites unless the user explicitly asks to share, publish, or deploy. Do not give the user server-start instructions when you can run it.

Before planning or implementing any mobile-app change, read this `AGENTS.md` in full. It is the source of truth for the template's runtime and component guidance.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Inventory item imagery uses one shared thumbnail treatment across drawer lists, search results, and item-editor previews. Items without photos show deterministic muted freezer-label tiles with label initials; list rows never use camera-icon placeholders, and photo capture remains an explicit editor action.

An open empty drawer uses one compact 76px row, matching an inventory item row, with its empty message and Add first item action on the same line. Do not return to a large centred empty-state panel inside a drawer.

Expiry emphasis applies only to the expiry-date line. During the final seven local calendar days it moves from an accessible soft red to a strong red at day zero; due-today and already-expired items keep the strongest red and show a warning symbol beside the date. Items without an expiry date remain visually unchanged.

Use “label” consistently for the required item name in the UI, application API, D1 schema, AI structured output, Google Sheet mirror, tests, and operational documentation. “Caption” is only permitted inside the historical compatibility migration that renames existing columns.

Adding or changing a photo automatically generates an AI label only when the Label field is blank and the user's AI-label preference is enabled. Automatic generation must re-check the current field before applying its result, so text entered while the request is running is never overwritten. An existing label is never changed by photo upload; the user can still explicitly press the magic-wand action beside the Label field to request a replacement.

A photo is attached only after the media endpoint succeeds. If upload validation fails, remove the temporary preview immediately and preserve any previously saved photo.

Inventory rows support a left swipe that reveals a destructive Delete action. A swipe never deletes immediately; the user must press the revealed action. Preserve vertical scrolling by direction-locking the row gesture only after a clearly horizontal drag.

Freezer and drawer deletion live in the freezer setup editor and require an explicit second confirmation press. The last freezer and the last drawer in a freezer cannot be deleted. When a structure contains items, the warning must list every affected item and make clear that proceeding deletes those items; confirmed deletion tombstones the items for backup recovery and soft-deletes the structure so retained history cannot block removal.

Drawer bands are toggles: tapping a closed drawer opens it, and tapping the currently open drawer collapses it.

Item add/edit sheets use an additional 8px horizontal form inset beyond the shared sheet padding so controls do not crowd the phone edges.

Item sheets open with focus on the photo action rather than auto-focusing the label field, so the real mobile keyboard is never opened unexpectedly.

Every bottom sheet must respect real safe areas at both ends. Its top edge stays below the operating system’s top inset, and its final actions retain comfortable clearance above the iPhone home indicator or Android navigation bar.

Native mobile form controls use at least 16px text so iOS Safari does not auto-zoom the page when a field receives focus. Keep native vertical scrolling and pinch zoom available as accessibility and recovery gestures; do not rely on pinch zoom to correct app layout. Date fields stack on narrow mobile viewports rather than competing for the intrinsic width of Safari's date control, and their right edge must remain contained within the item form and aligned with the notes field. Do not apply horizontal padding directly to native date inputs: iOS WebKit adds that padding outside a declared 100% width; use a non-sizing text offset instead.

Every bottom sheet has a conventional Back control at the top left that closes it. The full non-content header—from the grab bar through the title and optional subtitle—is the downward-drag dismissal target; do not limit swipe-to-close to the thin grab bar alone.

Bottom sheets with option lists must remain vertically scrollable on short mobile viewports. Keep every final option fully reachable above the safe area, including the inventory sort sheet.

Settings places Add to Home Screen immediately below Add feedback. Its installation sheet asks the user to choose iPhone/iPad or Android before showing concise Safari Share -> Add to Home Screen or Chrome menu -> Add to Home screen / Install app instructions, with both a device-choice back action and the standard sheet Back control.

Inventory sorting is a temporary household-wide results view, not a reordering of items inside the freezer hierarchy. Expiring soonest, Alphabetical, and Added date each open one flat list of all items in the active household using the search-results treatment; every row shows both freezer and drawer. The sort sheet keeps Default freezer view as its final option, and Done from any search or sorted results view clears the transient view and returns to the normal freezer/drawer hierarchy.

Feedback diagnostics are privacy-light and retained for 60 days. Record routes, statuses, timing, device/app state, and sanitized errors, but never inventory labels, notes, search text, secrets, or full invitation addresses. A user may explicitly attach one feedback photo; keep it private in R2, exclude it from logs and ordinary admin lists, and include its bytes only in the operator-authorized diagnostic download.

Feedback photo attachment is availability-first: optimise a photo in the browser when possible, but fall back to streaming the untouched original when decoding or conversion fails. Do not reject feedback photos for format, dimensions, metadata, or application-defined byte limits; only unavoidable hosting-platform request limits apply.

Household induction must never render browser-default grey inputs or buttons. Use the same rounded Icebox text fields, selectors, focus rings, and coral primary actions as the rest of the app, with clear vertical separation between labels and controls. While authenticated bootstrap data is loading, show a neutral branded loading state; never flash demo household inventory before the real account state arrives.

The operator console owns its own real viewport scroller because the global app shell locks body scrolling. Its content must remain scrollable through the final backup and archived-household sections on desktop, mobile Safari, and installed PWA layouts.

Freezers and drawers form one vertically scrollable hierarchy on the inventory screen. Freezers are top-level accordions and drawers are nested accordions inside them; each remains independently collapsible. A compact Open all / Close all control immediately to the right of Sort expands or collapses every freezer and drawer in the active household. There are no separate freezer tabs. Household switching and household creation live in Settings, and the main Add Item action is hidden while any sheet is open.

The top-right household identity and hamburger menu are one compact button. It shows the active household and opens Settings; do not split them into adjacent controls.

The freezer hierarchy follows the clean-ledger reference: flat white/cream rows, hairline separators, restrained teal icon accents, soft count pills, and clean Roboto list typography. Avoid dark filled freezer headers, coral hierarchy icons, heavy card borders, large radii, or nested shadows.

The inventory hierarchy starts directly with its freezer rows; do not repeat a household/freezer-count section heading beneath the app header. Freezer rows use the small double-door upright-freezer SVG asset rather than a generic box icon.

Expanded freezer contents use a slim vertical guide line to show that drawers are nested. Do not create a wide left gutter: drawer bands span the full panel width, their contents receive only a compact indent, and inventory rows extend to the right edge.

The `/admin` route is an operator console, not part of household navigation. Gate both its document route and every operator API with `OPERATOR_CHATGPT_USER_ID`. Household reset means tombstoning all active items and deleting their image bytes while preserving the household, freezers, drawers, members, and invitations. Household archive hides it from all members, revokes pending invitations, clears affected defaults, and keeps item tombstones for backup recovery. Both destructive actions require the operator to type the exact household name.

## Editing Boundary

- Build app-specific UI in `src/Prototype.tsx` and `src/prototype.css`.
- Treat `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/mobile/`, `public/assets/iphone/`, `public/assets/android/`, `public/assets/status/`, `vite.config.ts`, `worker/index.js`, and `scripts/prepare-sites-build.mjs` as protected runtime files. Do not edit, replace, remove, or recreate them unless the user explicitly asks to change the mobile runtime itself. For an explicit runtime change, update the affected lock hashes only after verifying the new runtime behavior.
- Run `npm run check:runtime` before preview or handoff. If it fails, restore the protected runtime instead of weakening or bypassing the check.
- `npm run build` preserves the mobile runtime and prepares the static Cloudflare Worker output required by Sites. Before a Sites handoff, confirm `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and source `.openai/hosting.json` exist, then run `npm run test:sites`. Do not replace this project with a Vinext starter.

## Runtime Contract

- `MobileRuntime` defaults to the native production branch. That branch fills the real viewport, uses normal browser scrolling and inputs, honours CSS `env(safe-area-inset-*)`, and never mounts simulator chrome. Do not make production conditional on user-agent sniffing.
- The legacy phone simulator remains available only in development through `?simulator=1` and explicit `simulator` props in runtime fixtures. Preserve it as a regression harness, not as the product shell.
- Local Vite development must never remain controlled by the production service worker. In `import.meta.env.DEV`, unregister service workers and clear only Icebox-named Cache Storage entries so port 4173 always reflects the current checkout rather than a stale production or staging bundle.
- Production text fields use the operating system keyboard. The shared keyboard provider remains only so existing components can blur focus before navigation; it reports zero simulated keyboard height in native mode and never mounts `KeyboardDock`.
- `MobileScroll` renders native browser scrolling in production and retains custom momentum only in simulator fixtures. Do not add pointer-capture scrolling, a custom cursor, or a fake scrollbar to the native branch.
- `BottomSheet` uses the real viewport and safe-area insets on mobile. At desktop widths it becomes a constrained, fully rounded dialog while keeping the same accessible Radix dialog semantics.
- Use `MobileScroll` directly for simple single-screen flows. Use `FlowStack` only for conventional multi-screen flows whose routes own fixed headers and footers; its simulator-specific geometry must not leak into the production inventory route.
- Use `Carousel` for a carousel, horizontal rail, swipeable cards, image or media strip, horizontally scrollable cards, chip rail, or other horizontal collection.
- For a layered app shell—such as a persistent composer, independently presented sheet, pushed/peek sidebar, or app-wide transition—compose directly in `Prototype.tsx` rather than forcing it through `FlowStack`. Keep app-owned fixed chrome as sibling layers outside `MobileScroll`.
- Render only scrollable content inside `MobileScroll`. Keep app-owned fixed actions and overlays outside it so real mobile safe areas and desktop positioning can be applied independently.
- Buttons, links, cards, and images inside `MobileScroll` should still allow drag scrolling when the pointer moves beyond tap slop. Use `data-scroll-drag="ignore"` only for rare controls that must own the drag gesture themselves.
- Fixed mobile actions use `env(safe-area-inset-bottom)` and desktop actions use responsive positioning. Do not reintroduce hard-coded simulated keyboard or device geometry into product CSS.
- Continue to use `KeyboardInput` and `KeyboardTextarea` so navigation can blur the active native field consistently and simulator fixtures remain testable.
- Use `BottomSheet` for shared edit/settings surfaces. Its props remain `open`, `onOpenChange`, `title`, optional `description`, optional `snap`, and `children`.

## Horizontal Carousels

- Use `Carousel` for horizontally draggable cards, images, media, chips, or other horizontal collections. Do not recreate these with `overflow-x`, custom pointer handlers, or a generic div.
- `Carousel` can be nested directly inside `MobileScroll`. It owns horizontal gestures and automatically yields vertical gestures to the parent.
- Never put `data-scroll-drag="ignore"` on or around a `Carousel`; doing so prevents vertical parent scrolling when a gesture begins inside it.
- Do not add CSS scroll snapping to `Carousel`; its runtime owns momentum and release motion.
- Use `data-scroll-drag="ignore"` only when a control must prevent parent scrolling in every drag direction.

See `src/mobile/COMPONENTS.md` for the full component and gesture contract.

## Keyboard Rule

Before presenting navigation or modal UI, blur the active field so the real mobile keyboard dismisses. The development simulator follows the same calls through its visual keyboard layer.

Call `keyboard.hide()` before:

- pushing, popping, or replacing FlowStack routes
- opening bottom sheets, action sheets, dialogs, menus, or navigation sheets
- starting transitions where the destination should not inherit text-input focus

`FlowStack` already hides the keyboard for `push`, `pop`, and `replace`. `BottomSheet` already hides it before opening. If you add new modal/sheet/navigation primitives, follow the same rule.

When a composer, search surface, or other keyboard-attached component closes, call `keyboard.hide()` in the same event before changing that component's open state. Position attached surfaces from `useKeyboardInsets()` rather than a separate timer or visibility flag so both dismiss together.

When any text-entry control loses focus, dismiss the simulated keyboard. If the control is custom or does not use the runtime's keyboard-aware fields, handle its blur event and call `keyboard.hide()` explicitly. Keep the keyboard open only when focus is moving directly to another text-entry control that should share the same keyboard session.

## Interaction Rules

- Do not trigger buttons or inputs after a pointer has become a drag. Preserve the drag suppression behavior in `MobileScroll`.
- Do not allow native browser image/file dragging inside the phone frame. Preserve the phone-level `dragstart` suppression and non-draggable image styles so scroll drags that begin on images still scroll the prototype.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for text entry so the simulated keyboard and safe-area insets stay connected.
- Fixed phone chrome should not animate with pushed screens. Screen content can animate; the status bar, camera cutout, and preview chrome should stay put.
- Keep the keyboard below the home indicator/safe area layer in z-index, and above ordinary app UI while visible.
- Keep the home indicator as the topmost safe-area layer in the z-index above everything else in the prototype.
