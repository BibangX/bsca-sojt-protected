# BSCA SOJT protected portal — first working version

This is a separate Node.js version of the pirate-map portal. It preserves the soft map artwork, cat captain, official logos, materials and external Google Forms links. It adds server-verified school Google sign-in, student accounts, a shared SQLite database, personal map status, direct Drive file submissions and a coordinator review desk.

## Run in Windows / VS Code

1. Install Node.js 22.13 or newer (Node 24 recommended for this package).
2. Extract this folder and open it in VS Code.
3. Run `npm.cmd ci`.
4. Run `npm.cmd run dev`.
5. Open http://localhost:5173.

The existing public Google Client ID is already configured for local testing. Use the original Google OAuth client that has http://localhost:5173 as an authorized JavaScript origin. This flow needs no OAuth client secret. School account policy and actual Google login still need browser testing.

Optional configuration: copy .env.example to .env, then edit values. Do not commit .env or the data folder.

## Account and progress rules

- Only server-verified Google accounts with verified email and hosted domain g.msuiit.edu.ph are accepted. The account ID is Google's stable subject, not an email supplied by the browser.
- New students confirm their name and unique student number; Google handles their password and account security.
- New map steps are Not started. Submitting a direct Drive PDF file link creates Awaiting review. The coordinator can request revisions, approve each file or mark replaced files as superseded.
- Only excelvan.jondonero@g.msuiit.edu.ph can access the review desk. Roles are assigned on the server; there is no role picker.
- File approval and step completion are separate. After checking all required documents, signatures and offline requirements, the coordinator explicitly marks the step complete. All current files must first be approved. A new submission reopens the step.
- Students see their own submissions only. Their personal progress appears on subsequent sign-ins and across devices using the same running server/database.
- Submission validates link format and the typed filename. It cannot inspect Drive contents, permissions or actual filenames. These remain part of coordinator review. PDF filenames start with the student's number.
- Keep old Google Forms for existing workflows. Opening or submitting those forms does not automatically update this database. This version's progress comes from submissions made inside the protected portal; Google Forms/Sheet synchronization is not configured.

## Hosting and privacy

This package must run on a Node server with a persistent writable data directory and HTTPS. GitHub Pages cannot run it. GitHub may store the code, but its static Pages deployment must not be used to host the portal folder.

For online hosting set APP_ORIGIN to the exact HTTPS site URL and PORT to the host's provided port. Add that HTTPS origin to the Google OAuth client's authorized JavaScript origins. Back up data/portal.sqlite using a SQLite-aware backup procedure; keep the data directory across deploys. A single server instance is supported. Do not run multiple independent copies with separate databases and expect synchronization.

Static portal routes, map images and templates in this server require a valid session. Public login-page code contains no portal documents. Once the protected host is verified, disable the previous public GitHub Pages/Workers versions and make the source repo private if their templates are intended to be private. Existing public copies are not protected by this new server. External Google Forms and Drive files have their own sharing settings.

Sessions expire after eight hours. Production HTTPS uses Secure, HttpOnly, SameSite cookies. State changes require same-origin requests and session CSRF tokens. Google verification challenges are single-use. Public authentication endpoints are rate limited. No production test-login route is included.

## Validation and limits

Run `npm.cmd test`. Automated tests cover domain rejection, unauthenticated routes/templates, direct-file link validation, registration, duplicate student numbers, CSRF, record isolation, coordinator-only approval/completion, reopening completed steps, logout and restart persistence. Tests inject identities directly into an in-process app; there is no HTTP bypass route.

Actual Google login, school policy, browser presentation and online hosting are not yet verified. This is the first working protected version for local validation, not an already-live deployment. The previous private preview remains the design preview; it does not run this backend.

## Coordinator workspace update

Coordinator tools open automatically after sign-in. The desk shows all student accounts (including incomplete registrations), a searchable clickable student list, queue statistics, selected-student progress out of nine steps, the matching map badges, document/status filters, file approval/revision controls, completion/reopen controls, and CSV export of the submission log. No student data is fabricated when the queue is empty. CSV includes portal submissions only, not unsynchronized Google Forms responses.

Updating an existing local installation: stop the server; replace server.mjs, portal/account.js, account.css and portal/account.css, and add portal/coordinator.js. Keep your data folder unchanged. Start again with npm.cmd run dev and refresh the browser. Dependencies are unchanged.

## Approved student emails

There is one Google sign-in button. The server recognizes excelvan.jondonero@g.msuiit.edu.ph as coordinator automatically. No coordinator code or shared password is used. Students must have a verified school Google account AND an active entry in the coordinator-managed allowlist.

After signing in as coordinator, use Approved student emails to add one school email, paste a list, or import an email-column CSV. Review the list before saving. Adding emails grants access but does not create fake student profiles; students confirm their details after signing in. Revoking access invalidates existing sessions and blocks subsequent sign-ins. Student records are retained, and re-adding the email allows the student to sign in again.

Existing student accounts are not automatically approved by this update. Add their school emails before they sign in again. The coordinator account remains accessible so you can manage the list. Keep the data folder when updating.

## Personal map stars

Map status chips are replaced by one three-star indicator under each level icon:

- 0 filled stars: level has not been opened and has no active submission.
- 1 filled star: student opened the level; submission is still pending.
- 2 filled stars: a file was submitted; review, corrections or explicit step completion is still pending. The step popup shows the precise file status and feedback.
- 3 filled stars: coordinator explicitly confirmed the full step complete.

Opening a level via its icon, Previous/Next, or a direct step link records the opening against the signed-in student's account. Reopening cannot award additional stars or approve a requirement. Openings persist in the existing database and do not overwrite saved submissions. Coordinator browsing does not award a student visit. Replaced/superseded files do not earn submission stars. A new submission reopens an already completed step, so it displays two stars until the coordinator finishes reviewing again.

The 3/9 completion count still counts completed steps only, not stars or visits. Google Forms responses remain separate until a verified integration is added.

For this update, stop the server and replace server.mjs plus the portal folder and account.css from the ZIP, keeping data unchanged. Restart and refresh the browser. The database adds the opened-step table automatically.
