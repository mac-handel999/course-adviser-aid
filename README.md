# Cos Advyza

Advyza is a results and transcript management tool for course advisers at
FUTO. It lets advisers enter results by year and semester, auto-grade and
total them, generate transcripts, track carry-over retakes, configure
per-semester credit load targets, view completion progress alongside GPA,
and export official documents with the department letterhead to Excel or
PDF. It supports per-course Test/Lab/Exam component scoring with automatic
totaling, optional Program and Remark fields per student, and a public
student portal for self-service result lookup. It installs as a PWA on
desktop and mobile, works offline, and syncs changes automatically when you
reconnect.

It is built as a static frontend with an Express API, Supabase for
authentication and storage, and is deployed on Vercel.

## Features

### Per-course component scoring

Courses can opt into **Test / Lab / Exam** breakdown instead of a single
score. When enabled, entering component scores auto-calculates the total
and the server validates that Test + Lab + Exam equals the saved score.
The per-course Excel export shows the four columns side by side in
component mode, or a single Score column otherwise.

### Program and Remark fields

Each result row can carry an optional **Program** (of study) and **Remark**
(free-text). These appear in the per-course roster, Excel exports, and the
public student portal lookup.

### Student roster

Students have a canonical roster entry with their registration number, full
name, and program. Results rows link to the student record via `student_id`
(new rows) while keeping the denormalized `reg_no` / `student_name` columns
for backward compatibility. The Class Roster section under Settings lets you
manage the canonical list — add, edit, delete, and search students.

### Public student portal

Generate a shareable portal URL with a passcode for any class set. Students
enter their registration number to view their full academic record —
scores, grades, GPA, program, and remarks — across all semesters.

### Course management

Courses are first-class records with their own metadata (`offering_school`,
`use_score_components`, `credit_unit`). The API supports full CRUD: create,
read, update (PATCH), and delete.

### Carry-over tracking

Flag a result as carry-over to mark it for retake. Carry-over rows are
excluded from GPA calculations and highlighted in the roster badge.

```
Browser (index.html / login.html / app.html)
   │
   │  Supabase Auth (sign in / sign up / session) — anon key, client-side
   │  fetch('/api/results', …)  — Bearer <access token>
   ▼
Express API (server/app.js, routes under /api)
   │
   │  Supabase service role key — server-side only, bypasses RLS
   ▼
Supabase Postgres (public.results table)
```

Auth happens directly between the browser and Supabase (that's what the
anon key is for). Reading and writing results goes through the Express
API instead of straight to Supabase — the API checks the caller's
Supabase session token, then uses the service role key to talk to
Postgres. That keeps the powerful service role key off the client
entirely.

## PWA and offline mode

Advyza is installable as a PWA on Chrome, Edge, and mobile browsers.
The app shell (HTML, CSS, JS) is cached by a service worker so the
interface loads even with no internet connection. When the device comes
back online, any queued changes are synced automatically.

- **Install**: use the browser's "Add to home screen" or "Install app"
  option.
- **Offline editing**: edits are saved to localStorage immediately.
  If you are signed in and offline, API writes are queued and replayed
  when connectivity returns.
- **Online indicator**: the top bar shows Online / Offline status.

## Project layout

```
futo-portal/
├── index.html, login.html, app.html   Pages
├── css/                                base.css, landing.css, app.css
├── js/
│   ├── landing.js            Mobile nav + footer year
│   ├── supabase-config.js    Anon key + URL — client-side auth only
│   ├── api-config.js         Base URL for the Express API
│   ├── auth.js               Sign-in / sign-up form logic
│   └── app.js                Data model, grading, rendering, Excel export, API sync
├── assets/
│   ├── logo.svg, logo.png, favicon.png
├── server/
│   ├── app.js                 Express app (middleware + routes)
│   ├── routes/results.js      GET/POST/PUT/DELETE /api/results
│   ├── routes/courses.js      GET/POST/PATCH/DELETE /api/courses
│   ├── routes/students.js     GET/POST/PATCH/DELETE /api/students (roster management)
│   ├── routes/publicPortal.js Student result lookup (no auth)
│   ├── middleware/requireAuth.js
│   ├── lib/supabaseAdmin.js   Service-role Supabase client (server-only)
│   └── lib/adviserSettings.js Adviser settings helpers
├── scripts/
│   ├── migrate-courses-dryrun.js   Phase 1: courses dry-run (read-only)
│   ├── migrate-courses.js          Phase 2: courses backfill (writes)
│   ├── migrate-students-dryrun.js  Phase 1: students dry-run (read-only)
│   └── migrate-students.js         Phase 2: students backfill (writes)
├── api/index.js               Vercel serverless function wrapping server/app.js
├── server.js                  Local dev entry point (`npm run dev`)
├── sql/schema.sql             Run once in the Supabase SQL editor
├── package.json, vercel.json, .env.example, .gitignore
```

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. Run `sql/schema.sql` in the SQL editor — creates the `results` table,
   RLS policies, and an `updated_at` trigger.
3. From **Project Settings → API**, grab:
   - **Project URL** and **anon public** key → put both in
     `js/supabase-config.js`.
   - **Project URL** (same one) and **service_role** key → put both in
     a `.env` file (copy `.env.example`) for local dev, and in Vercel's
     environment variables for production. **Never** put the service
     role key in any frontend file.
4. Under **Authentication → Settings**, turn off "Confirm email" while
   testing so new accounts don't need an email click.

### 2. Backend (local)

```
npm install
cp .env.example .env   # then fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run dev             # starts the API on http://localhost:3001
```

### 3. Running the whole thing locally

Easiest: install the Vercel CLI and run everything together the same way
it'll run in production (static files + `/api` functions, one origin, no
CORS to think about):

```
npm i -g vercel
vercel dev
```

Alternative: run `npm run dev` (API on port 3001) and serve the frontend
separately (e.g. `python3 -m http.server 8000`), setting
`API_BASE = 'http://localhost:3001'` in `js/api-config.js`. The Express
app already has CORS enabled for this case.

### 4. Deploying to Vercel

1. Push this project to a git repo and import it in Vercel.
2. In the Vercel project's **Environment Variables**, add `SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy. Vercel serves the HTML/CSS/JS as static files and
   `api/index.js` as a serverless function; `vercel.json` rewrites all
   `/api/*` requests to it.
4. Leave `API_BASE` as `''` in `js/api-config.js` for this — same-origin.

## How data flows

- **Signed in**: every edit to a result row calls the Express API
  (debounced ~600ms after you stop typing). Deleting a row calls
  `DELETE /api/results/:id`. On sign-in, the app loads all rows via
  `GET /api/results`.
- **Courses**: the app fetches the user's course list via
  `GET /api/courses` (including `offering_school` and `use_score_components`
  flags). Creating or editing a course hits `POST /api/courses` or
  `PATCH /api/courses/:id`.
- **Public portal**: the student lookup endpoint
  (`POST /api/portal/:slug/lookup`) is unauthenticated — it verifies the
  passcode and returns the student's full record.
- **Guest (not signed in, or Supabase not configured)**: results stay in
  memory for that browser tab only.

## API endpoints

| Method   | Route                        | Description                          |
| -------- | ---------------------------- | ------------------------------------ |
| GET      | `/api/courses`               | List the adviser's courses           |
| POST     | `/api/courses`               | Create a course                      |
| PATCH    | `/api/courses/:id`           | Update course metadata               |
| DELETE   | `/api/courses/:id`           | Delete a course + its results        |
| GET      | `/api/results`               | Load all of the adviser's results    |
| POST     | `/api/results`               | Create a result row                  |
| PUT      | `/api/results/:id`           | Update a result row                  |
| DELETE   | `/api/results/:id`           | Delete a result row                  |
| GET      | `/api/students`              | List the adviser's student roster    |
| GET      | `/api/students/reg/:reg_no`  | Look up a student by reg no          |
| POST     | `/api/students`              | Create a new student roster entry    |
| PATCH    | `/api/students/:id`          | Update a student's name/program      |
| DELETE   | `/api/students/:id`          | Delete a student (if no linked results) |
| POST     | `/api/portal/:slug/lookup`   | Public result lookup (no auth)       |

## Migrations

Two migration phases run as standalone scripts using the Supabase service
role key. Always run Phase 1 first to review, then Phase 2 to write.

### Courses migration (results → courses)

1. `node scripts/migrate-courses-dryrun.js` — read-only report of
   `(user/year/sem/course_code)` groups and any conflicting
   `(title, unit)` combinations.
2. `node scripts/migrate-courses.js` — creates `courses` rows (upsert) and
   backfills `results.course_id`. Safe to re-run.

### Students migration (results → students)

1. `node scripts/migrate-students-dryrun.js` — read-only report of
   `(user/reg_no)` groups and any conflicting `(student_name, program)`
   combinations (e.g. spelling variants across imports).
2. `node scripts/migrate-students.js` — creates `students` rows (upsert) and
   backfills `results.student_id`. Uses the most frequent `(name, program)`
   combination to resolve conflicts. Safe to re-run.

Neither migration modifies `results.reg_no`, `results.student_name`, or
`results.program` — those columns are kept intact as historical copies.

## Notes / things to revisit

- RLS policies in `schema.sql` are a second line of defense (the API
  bypasses them via the service role key); actual authorization for API
  requests happens in `server/middleware/requireAuth.js`.
- Every signed-in account can only read, update, and delete their own
  result rows. The Express API enforces this per-user isolation in
  `server/routes/results.js`; the RLS policies in `schema.sql` act as a
  secondary safeguard in case the anon key is used to query the table
  directly.
- No password-reset flow is wired into the sign-in page yet (Supabase
  supports it via `supabaseClient.auth.resetPasswordForEmail`).





  