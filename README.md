# Vertex

Vertex is the separate Accelerated Geometry learning app in the Claro product family. It contains the currently published Canvas sections for Chapters 1–3, organized into collapsible course units with persistent practice sessions.

## Local preview

Serve this folder with any static web server. The dashboard, module-empty state, app switcher, title updates, and feedback form work without a build step. The premium API routes require the Vercel runtime.

## Vercel configuration

Deploy this folder as its own Vercel project and assign `vertexmath.vercel.app`. No Claro project files or deployment settings are changed here.

Set these server-only environment variables in Vertex:

- `ACCESS_CREDENTIALS_JSON`: PBKDF2-SHA256 records shaped as `{id,role,salt,iterations,hash}`. `role` is `premium`, `mod`, or `admin`.
- `ACCESS_SESSION_SECRET`: a unique long random secret for Vertex session signing.
- `ACCESS_SESSION_TTL_SECONDS`: optional session duration; defaults to 30 days.
- `MODERATION_KV_REST_API_URL` and `MODERATION_KV_REST_API_TOKEN`: the REST KV storage used for deletion requests, audit history, and approved suppression records.

The password records may be the same credential set as Claro so the passwords remain compatible. Sessions are deliberately issued per app domain; browser cookies cannot safely be shared across separate `*.vercel.app` domains. Approved suppressions are visible to every learner, while request history is limited to Moderator/Admin sessions.

Never put passwords, raw hashes, salts, or the session secret in client-side files. See `.env.example` for variable names only.

## Curriculum refreshes

The curated current curriculum is in `curriculum.js`. Its source manifest uses stable Canvas section/source identities and merge keys, so an import refresh updates existing sections rather than creating PDF-by-PDF duplicates. Keep teacher wording such as “Angle Addition Postulate” and “Congruent Supplements Theorem” exact.

## Feedback delivery

The feedback form supports general feedback, module requests, and feedback about the feedback experience. It intentionally does not submit anywhere until a server-owned `VERTEX_FEEDBACK_URL` or equivalent endpoint is selected and implemented; no feedback is silently discarded.
