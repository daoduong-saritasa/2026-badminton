# Deployment

This guide prepares a company-owned Supabase project and a static Cloudflare Pages site. It
does not authorize or perform account creation, purchases, production mutations, or deployment.

## Deployment inputs

Resolve these inputs before you provision anything:

- The company owners and administrators for both accounts. Do not use a personal account as
  the sole owner.
- The Supabase organization, project name, region, database password, and project reference.
- The Cloudflare account, production branch, `pages.dev` name, and optional custom domain.
- The final production URL, event date, entrants, group allocation, and initial staff PIN.
- Whether the Free-plan pause and backup limitations are acceptable. Use a paid plan if the
  company requires inactivity protection, downloadable backups, support, or a stronger recovery
  objective.

## Current service and license check

Recheck this section immediately before provisioning because service terms and plan limits can
change.

As checked on 2026-09-09:

- Supabase documents two Free projects, a 500 MB database, Auth, Realtime, and Edge Function
  quotas. It may pause a Free project after about seven days of low activity, and downloadable
  database backups are unavailable on Free. Review the [Supabase pricing page](https://supabase.com/pricing),
  [billing documentation](https://supabase.com/docs/guides/platform/billing-on-supabase),
  [project-pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing), and
  current legal terms with the company account owner.
- Cloudflare documents 500 Pages builds per month, one concurrent build, 20,000 files, and a
  25 MiB single-file limit on Free. This application uses static Pages assets and no Pages
  Functions. Review the [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
  and current legal terms with the company account owner.
- Installed direct application and build dependencies report permissive MIT, Apache-2.0, or ISC
  licenses. Be Vietnam Pro reports OFL-1.1; its notice is retained in
  `THIRD_PARTY_NOTICES.md` and `public/fonts/BeVietnamPro-OFL.txt`. Rerun the dependency metadata
  check after upgrades and review any exception manually:

~~~sh
node -e 'const p=require("./package.json"); for (const n of Object.keys({...p.dependencies,...p.devDependencies})) { const x=require(`./node_modules/${n}/package.json`); console.log(`${n}@${x.version}: ${x.license ?? JSON.stringify(x.licenses)}`) }'
~~~

Plan capacity is not legal approval. The company account owner remains responsible for accepting
the current service terms, privacy obligations, data location, and procurement requirements.

## Local Supabase

Start from a clean disposable database whenever migrations or authorization logic change:

~~~sh
npm install
npm exec supabase -- start
npm exec supabase -- db reset
npm exec supabase -- functions serve
~~~

Copy the local URL and browser-safe key printed by `supabase start` into `.env.local`:

~~~dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local publishable or anon key>
~~~

Run the SQL and Edge integration suite only against that local stack:

~~~sh
npm exec vitest -- run tests/integration
~~~

Regenerate the checked-in public schema types after migrations:

~~~sh
SUPABASE_TELEMETRY_DISABLED=1 npm exec supabase -- gen types typescript --local > src/lib/database.types.ts
~~~

The local database container is named `supabase_db_badminton`. Open an interactive database
session so the initial PIN does not enter shell history:

~~~sh
docker exec -it supabase_db_badminton psql --username postgres --dbname postgres
~~~

At the `psql` prompt, provision or replace the local PIN:

~~~sql
\prompt 'Initial staff PIN: ' initial_staff_pin
insert into private.staff_config (singleton, pin_hash, generation)
values (
  true,
  extensions.crypt(:'initial_staff_pin', extensions.gen_salt('bf', 12)),
  1
)
on conflict (singleton) do update
set pin_hash = excluded.pin_hash,
    generation = private.staff_config.generation + 1,
    updated_at = clock_timestamp();
\unset initial_staff_pin
~~~

## Create and publish Supabase

Perform this step when the company has approved deployment, not during ordinary local work.

1. In the company-owned Supabase organization, create the project in the approved region. Store
   the generated database password in the company password manager.
2. Under **Authentication**, enable anonymous sign-ins. Do not enable providers this application
   does not use.
3. Authenticate and link the checked-out repository to the exact project:

   ~~~sh
   npm exec supabase -- login
   npm exec supabase -- projects list
   npm exec supabase -- link --project-ref <company-project-ref>
   ~~~

4. Review the linked project reference, the migration list, and the production backup. Then apply
   the checked-in migrations without the local seed:

   ~~~sh
   npm exec supabase -- migration list
   npm exec supabase -- db push
   ~~~

   The migrations create the public read/RPC boundary, private authorization tables, transaction
   functions, and Realtime publication. Afterward, use Supabase **Database > Publications** to
   confirm only the intended public tournament tables are in `supabase_realtime`. Confirm the
   Security Advisor reports no unintended public access to private staff, PIN, ownership, rate
   limit, or mutation-audit data.

5. Deploy both checked-in Edge Functions:

   ~~~sh
   npm exec supabase -- functions deploy staff-pin --project-ref <company-project-ref>
   npm exec supabase -- functions deploy rotate-pin --project-ref <company-project-ref>
   ~~~

   Hosted Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` to its Edge runtime. Never copy the service-role value into
   Cloudflare, a `VITE_` variable, source control, or logs.

6. From **Connect** in the Supabase dashboard, copy a `psql` connection command that prompts for
   the database password. Do not put the password in the URI or shell history. Run the same
   interactive `\prompt` SQL shown in **Local Supabase** to create the initial production PIN.
   Close the database session and store the PIN in the approved company secret channel.

These commands follow the official [Supabase migration](https://supabase.com/docs/guides/deployment/database-migrations)
and [Edge Function deployment](https://supabase.com/docs/guides/functions/deploy) flows. Prefer the
Supabase GitHub integration or an approved CI pipeline for repeat deployments; require production
approval before migrations run.

## Configure Cloudflare Pages

After Supabase is published, create the Pages project in the company Cloudflare account:

1. Import the approved Git repository under **Workers & Pages**.
2. Set the production branch to the approved release branch, build command to `npm run build`,
   and output directory to `dist`. Leave Pages Functions disabled; the repository produces static
   Vite assets.
3. Under **Settings > Environment variables**, add these values to production and any preview
   environment that should use Supabase:

   - `VITE_SUPABASE_URL`: the project URL from Supabase **Settings > API**.
   - `VITE_SUPABASE_ANON_KEY`: the browser-safe publishable key, or the legacy `anon` key if that
     is what the project exposes.

4. Verify that no secret or service-role key appears in build settings or build logs. Trigger the
   deployment only after the account owner approves it.
5. After the `pages.dev` deployment passes the smoke checks, attach the approved custom domain if
   needed and update any company DNS/change records.

Cloudflare’s current React/Vite configuration is documented as `npm run build` with `dist` output
in its [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## Staff PIN controls

The staff PIN accepts 4–12 decimal digits. PostgreSQL hashes it with bcrypt cost 12 through
`pgcrypto`; neither Edge Function logs request bodies, PINs, bearer tokens, or database error
bodies.

The `staff-pin` endpoint permits four failed attempts within a rolling 15-minute window. The fifth
failure blocks that verified Auth user for 15 minutes. A successful PIN clears the bucket. The
function hashes the verified user UUID before storage.

The function deliberately trusts no client address or forwarding header for bucket identity. Its
only trusted request metadata is the bearer identity verified by Supabase Auth and matched against
the token's subject and session claims. Supabase Auth's separate anonymous-sign-in IP limit
constrains creation of replacement anonymous identities.

Every request first presents its bearer token to Supabase Auth. The function accepts the JWT
`session_id` only after Auth verifies the token and its `sub` matches the returned user. The
service-role key remains in the Edge environment and never reaches browser code.

Staff grants expire exactly seven days after issuance. Rotating the PIN increments its generation,
revokes every existing grant, and issues a new seven-day grant only to the session that performed
the authorized rotation. During normal operation, use the application rotation control.

## Day-before-event smoke procedure

Run this procedure 24 hours before the event with two browsers or one normal and one private
window. Record the operator, timestamp, deployed commit, project reference, and result.

1. Open the company Supabase dashboard. If the Free project is paused, select **Resume project**
   and wait until its health checks pass. Confirm database, Auth, Realtime, and both Edge Functions
   show no active incident.
2. Open the production site without staff access. Confirm the tournament name, fixtures, courts,
   standings, and knockout placeholders load. Confirm public viewing does not create an Auth user.
3. Enter the staff PIN in browser A. Confirm organizer controls appear. In browser B, keep the
   public matches view open.
4. Change one unstarted match to an unused court/order combination, publish the schedule, and
   confirm browser B updates without reload. Restore the original assignment and confirm the
   second Realtime update. This verifies production read, authorized write, and Realtime paths.
5. Test the live scoring path in one of two ways:

   - Preferred: repeat the deployment against a separate company staging project, start a match,
     add and undo a point, reload the scorer, and use browser B to take over. Confirm browser A can
     no longer score and the public score updates exactly once.
   - If production is the only project: finalize entrants first, start the first official match,
     add and undo one point, and leave it at 0–0 in `playing` state. This permanently locks setup
     and publishes the match as playing, so obtain the tournament organizer's approval first.

6. In browser A, sign out and confirm organizer/referee controls close. Sign in again, but do not
   rotate the PIN unless the planned distribution procedure includes notifying every staff member.
7. Run one final public read from a phone on the event network. Check landscape scoring controls,
   safe-area spacing, focus/touch behavior, and live updates between both browsers.

If any step fails, stop operational changes. Capture the timestamp, browser, action, and sanitized
error; do not log PINs, tokens, database passwords, or request bodies. Fix and repeat the complete
procedure before the event.
