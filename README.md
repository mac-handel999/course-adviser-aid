# FUTO Public Health Results Portal

A results & transcript portal for the Department of Public Health at FUTO:
a static frontend, an Express API, Supabase for auth + storage, deployed
on Vercel.

## Architecture

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
│   ├── middleware/requireAuth.js
│   └── lib/supabaseAdmin.js   Service-role Supabase client (server-only)
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
   `api/index.js` as a serverless function; `vercel.json` routes all
   `/api/*` requests to it.
4. Leave `API_BASE` as `''` in `js/api-config.js` for this — same-origin.

## How data flows

- **Signed in**: every edit to a result row calls the Express API
  (debounced ~600ms after you stop typing). Deleting a row calls
  `DELETE /api/results/:id`. On sign-in, the app loads all rows via
  `GET /api/results`.
- **Guest (not signed in, or Supabase not configured)**: results stay in
  memory for that browser tab only. Use "Save data" / "Load data" in the
  app for a `.json` backup.

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