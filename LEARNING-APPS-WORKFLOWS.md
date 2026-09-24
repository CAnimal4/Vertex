# Learning-app maintenance workflows

This document is the source-of-truth checklist for making coordinated changes across the learning apps. The app folders are:

- `School Apps/Claro` — Claro Spanish
- `School Apps/Vertex` — Vertex Math
- `School Apps/Meridian` — Meridian AP Human Geography
- `School Apps/Atlas` — Atlas collection hub

Claro, Vertex, and Meridian are static-first learning apps. Keep production deployment separate and do not copy one app's entire stylesheet or runtime into another.

## Add a module

1. Decide which dashboard/class owns the module. Do not add placeholder lessons just to make an empty dashboard look populated.
2. In Claro, add the module record to the existing module definitions in `Claro/app.js`, then add its toggle/metadata to the matching settings markup in `Claro/index.html`.
3. In Vertex, add a record to `MODULES` in `Vertex/app.js` with a stable key, `dashboardKey`, title, description/metadata, and numeric `order`. Add future dashboard records to `DASHBOARDS` rather than branching on display text.
4. Keep module keys stable. Saved settings and analytics use them for persistence and migration.
5. Gate premium content at the server/API boundary when it is sensitive. A static JavaScript bundle cannot protect a premium lesson merely because its button is hidden.
6. Test a fresh browser, an existing saved state, direct dashboard URLs, refresh, module ordering, empty state, and premium/free boundaries.

## Add or rotate premium passwords

1. Never put a raw password, hash, salt, or secret in HTML, client JavaScript, screenshots, commits, or chat.
2. Generate a PBKDF2-SHA256 record outside the repository for each credential: `{id, salt, iterations, hash}`. Use a high iteration count (the Vertex verifier rejects values below 100,000).
3. Update the server-only Vercel environment variable `PREMIUM_PASSWORD_HASHES_JSON` in each deployed learning-app project with the same record set. Keep `PREMIUM_SESSION_SECRET` unique per app and rotate it when sessions must be invalidated.
4. Preserve Claro's existing permanent-access behavior while migrating its validation to the same server-side mechanism. Do not create a second unrelated password bypass.
5. Verify invalid passwords return a generic failure, valid passwords create an HttpOnly/Secure/SameSite session, tampered/expired cookies fail, and logout clears the session.
6. Because the apps use separate Vercel domains, sessions are intentionally app-specific. The same passwords work in both apps, but cookies are not shared.

## Coordinate a visual change

1. Inspect both apps and identify the canonical asset/component first. For logos, update the single canonical PNG plus favicon, Apple touch icon, manifest, local app-switcher reference, remote sibling reference, and cache-buster.
2. Keep each app's identity: Claro blue and Spanish terminology; Vertex green and math/geometry terminology. Shared UI geometry, components, and interaction behavior are defined by `shared/ui.css` and `shared/app-config.json`. Run `node shared/sync-ui.mjs` after every shared UI change; it regenerates both app copies. `node shared/check-parity.mjs` verifies the shared contract. Only approved brand/theme/content values differ.
3. For shared header changes, update both app-switcher menus, current-app state, keyboard/Escape behavior, responsive layout, and direct links.
4. For dashboard changes, preserve truthful empty states. Never invent module counts, progress, or session rows.
5. Run `node --check` on both app scripts, then browser-test desktop and narrow viewports, direct URLs, refresh, dropdowns, modals, feedback, and premium controls.

## Announce learner-visible changes

Whenever a release adds a module, lesson, resource, useful option, or other meaningful learner-facing change, add an item to the shared Notification Center. Keep notifications about product changes and learning tools; do not use them for general messages. The bell stays unread until the learner dismisses the item or finishes/skips its mini-tour.

1. For a change that applies to every app, register it in `shared/app-shared.js`. For a Claro-, Vertex-, or Meridian-only change, register it in that app's `app.js` or curriculum adapter before `DOMContentLoaded`.
2. Use `LearningAppShared.registerUpdate({ id, app, title, copy, tourSteps })`. IDs must be stable and unique per release. Set `app` to `all`, `claro`, `vertex`, or `meridian`. Keep `copy` short and specific.
3. Attach a short `tourSteps` array when showing where/how to use the feature will help. Each step has `title`, `copy`, and a real `target`: `home`, `modules`, `practice`, `review`, or `test2`. If a feature needs another target, add its real selector to the shared `focusFeature` map before using it. Tours can be skipped or closed, and completion/dismissal is persisted per app and learner.
4. Example:

   ```js
   window.LearningAppShared?.registerUpdate({
     id: 'vertex-geometry-3-5-2026-09',
     app: 'vertex',
     title: 'New: Lesson 3-5 practice',
     copy: 'Practice equations of parallel and perpendicular lines.',
     tourSteps: [
       { title: 'Choose the lesson', copy: 'Open Modules and select Lesson 3-5.', target: 'modules' },
       { title: 'Start a practice round', copy: 'Answer slope and line-equation prompts.', target: 'practice' }
     ]
   });
   ```

5. If the shared runtime changes, run `node shared/sync-ui.mjs`, update the shared-asset cache version in all three app index files, then run `node shared/check-parity.mjs`. Verify the bell dot, notification dismissal and completion, tour targets, and the app-specific versus app-wide scope in a browser.
6. For new Canvas modules or files, inspect the live source first, preserve its source link and exact title in the app Library/source map, add question content only from inspected material, and record any Canvas sign-in limitation. Never create placeholder modules or infer unseen lesson content.
7. Register announcements before the shared runtime installs on `DOMContentLoaded`: app-specific `app.js` files execute before then. For future registrations added after installation, call `LearningAppShared.registerUpdate(...)` and `LearningAppShared.refreshUpdates?.()` so the active notification list and unread dot update immediately.

## Feedback + Tally workflow

1. Use the shared feedback form `https://tally.so/r/68grLO` and Premium Pass request form `https://tally.so/r/OD68ap`.
2. Always pass `app_name` (`atlas`, `claro`, `vertex`, or `meridian`), dashboard/class, module context, `page_url`, `source`, `feedback_type`, and message. Module requests must include the requested module in a dedicated field and in the message as a compatibility fallback. Both shared forms use `@page_url` for post-submit return to the originating app.

Admin question-removal workflow: `/admin` is a convenience gate using the exact password configured in each app. Authorized users can queue the current Claro question in a bounded cookie, then open the configured Tally export form after the admin submits the prefilled form. Cookies are browser-scoped; production removal still requires applying the exported question IDs to source data before deployment. Vertex exposes the same infrastructure and remains empty until question modules exist.
3. If the Tally schema changes, update both apps' prefill keys in the same change and submit one safe test from each app. Do not submit real passwords or sensitive student information.
4. Editing the Tally form or verifying submissions requires an authenticated Tally workspace session. Public form reachability alone is not proof that fields are mapped correctly.

## Release checklist

- Confirm only intended app folders changed.
- Run syntax checks and focused browser QA.
- Check logo alpha and cache-buster references.
- Verify no secrets are present with a redacted search.
- Record environment variables/domain changes separately from source changes.
- Do not deploy until production authorization and Vercel settings are confirmed.
