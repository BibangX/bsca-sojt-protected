# BSCA SOJT Portal — Netlify + Supabase

Protected deployment edition. Keeps the pirate map, templates, Google school sign-in, coordinator email allowlist, Drive file submissions, reviews, and persistent stars.

## GitHub upload
Upload the CONTENTS of this folder to the root of your dedicated private repository. Replace matching files from the previous local edition. Never upload `.env`, database credentials, `node_modules`, or a local `data` directory. GitHub Pages cannot run this edition.

## Supabase
Run `schema.sql` in the project's SQL Editor. If you already ran the supplied setup script, the eight matching tables exist; the CREATE statements are safe to repeat. Tables use the private `portal` schema and are not exposed to anonymous or signed-in Data API users. The backend connects directly with the database credential and performs its own role and ownership checks. This edition does not use Supabase Auth.

Copy Connect > Direct > Transaction pooler > shared pooler URI (host ending in `.pooler.supabase.com`, port 6543). Replace `[YOUR-PASSWORD]` with your database password, URL-encoding special characters. Enter the result only as Netlify's secret `DATABASE_URL`; do not commit it. Do not purchase the IPv4 add-on.

## Netlify configuration
Import the dedicated repository on the Free plan. Settings are supplied in `netlify.toml`:
- Build command: `npm run build`
- Publish directory: `public`
- Functions directory: `netlify/functions`
- Node: 22

Only `robots.txt` is published statically. All portal pages, images and template downloads pass through the function's session check. Do not change the publish directory to the repository root or `portal`.

Set these environment variables in Netlify, available to Functions:
- `DATABASE_URL`: full shared transaction pooler URI including password (secret)
- `APP_ORIGIN`: exact final HTTPS Netlify site URL, no trailing slash
- `GOOGLE_CLIENT_ID`: `559253472044-ek8vsrlh19ik12iekci4mob8aptbg181.apps.googleusercontent.com`

The site returns setup-incomplete until the first two variables are present. If a build assigns the site URL first, set APP_ORIGIN to that address and redeploy. Do not put credentials into build commands or the repository.

In the existing Google Cloud OAuth Web client, add the same HTTPS APP_ORIGIN under Authorized JavaScript origins. Keep existing localhost entries for local testing. No client secret is needed for this Google ID-token sign-in flow.

Only verified school Workspace identities with an active coordinator-approved email may enter. Coordinator: excelvan.jondonero@g.msuiit.edu.ph. Students must be added from the coordinator desk before first sign-in.

## Local test
Install Node 22 or later, copy `.env.example` to `.env`, fill in the database URI privately, then:

```
npm ci
npm run dev
```

Local testing uses the configured Supabase database; use a separate test project for disposable data. Never set PG_TEST in production.

## Verification
`npm test` uses embedded PostgreSQL (PGlite), mocked Google identity verification, and the serverless HTTP adapter. It checks privacy, roles, CSRF, registration, allowlisting/revocation, direct Drive URLs, review/completion, stars and one-use authentication across application instances. It does not verify external connectivity, actual Google accounts, or Netlify's deployed routing. No production authentication bypass is included.

After deployment, test coordinator login, allow one test student, student registration, map opening, file submission, coordinator approval/completion, reload and sign-in from a second browser. Test that an unlisted school account cannot enter and logged-out template URLs redirect to login. Stars: 0 unopened, 1 opened, 2 submitted or revision/awaiting final completion, 3 explicitly completed by coordinator.

Google Forms/Sheets submissions are separate and do not automatically update portal stars. No local SQLite records are migrated by this package.

## No-cost operation
Keep Netlify and Supabase on Free plans and use the supplied netlify.app address. Documents remain in Google Drive. Free plans have usage limits and may pause service; they are not unlimited hosting. Monitor usage and export important records. No paid add-ons, upgrades or automatic top-ups are needed by this code.

## Module compatibility update
Delete the old `netlify/functions/portal.mjs` from GitHub. This version uses `netlify/functions/portal.js` with its directory-level `package.json` and explicit dynamic import. Replace `netlify.toml` as well. Keeping both entry files can cause duplicate function names.

## Sequential levels and early access
Students begin with Level 1. Later levels unlock only when all earlier levels have three stars (coordinator-confirmed completion). Opening a level or submitting a file alone does not unlock the next one. Existing records are preserved.

For a student's early-access request, select their record in the coordinator desk and enable early access. This lifts the level restriction for that student, allowing them to open later levels and download their templates. It does not award stars or approve documents. The coordinator can revoke the exception at any time. Changes are saved per student and recorded in the audit log. Students contact the coordinator to request permission; the portal does not send a request automatically.

## Same-tab Google sign-in update
Before uploading this update, add this exact Authorized redirect URI to the existing Google OAuth Web client:
https://bsca-sojt-portal-protected.netlify.app/api/login/redirect
Keep the existing Authorized JavaScript origin. No client secret is required. The callback is based on APP_ORIGIN, so add the equivalent callback when moving hosts. Google posts the signed credential back to the same browser tab; the server validates double-submit CSRF, the one-use challenge nonce, school identity and enrollment allowlist before creating a session. Actual Google/mobile login must be tested after deployment.
