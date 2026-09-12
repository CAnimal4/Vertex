# Vertex

Vertex is the separate Accelerated Geometry learning app in the Claro product family. It intentionally starts with one dashboard and no content modules.

## Local preview

Serve this folder with any static web server. The dashboard, module-empty state, app switcher, title updates, and feedback form work without a build step. The premium API routes require the Vercel runtime.

## Vercel configuration

Deploy this folder as its own Vercel project and assign `vertexmath.vercel.app`. No Claro project files or deployment settings are changed here.

Set these server-only environment variables in Vertex:

- `PREMIUM_PASSWORD_HASHES_JSON`: the PBKDF2-SHA256 credential records generated from the existing Claro credential set.
- `PREMIUM_SESSION_SECRET`: a unique long random secret for Vertex session signing.
- `PREMIUM_SESSION_TTL_SECONDS`: optional session duration; defaults to 30 days.

The password records must be the same credential set as Claro so the passwords remain compatible. Sessions are deliberately issued per app domain; browser cookies cannot safely be shared across separate `*.vercel.app` domains.

Never put passwords, raw hashes, salts, or the session secret in client-side files. See `.env.example` for variable names only.

## Adding modules later

Add records to `MODULES` in `app.js` with a dashboard key, title, description, metadata, and numeric `order`. The renderer sorts by `order` and already handles an empty set. Add dashboards to `DASHBOARDS` when new classes are ready.

## Feedback delivery

The feedback form supports general feedback, module requests, and feedback about the feedback experience. It intentionally does not submit anywhere until a server-owned `VERTEX_FEEDBACK_URL` or equivalent endpoint is selected and implemented; no feedback is silently discarded.
