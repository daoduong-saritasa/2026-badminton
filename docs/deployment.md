# Deployment

## Local Supabase

Start from a clean disposable database whenever migrations or authorization logic change:

~~~sh
npm exec supabase -- start
npm exec supabase -- db reset
npm exec supabase -- functions serve
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

Changing the stored PIN generation invalidates existing grants. During normal operation,
authorized staff should use the application rotation control, which calls `rotate-pin` and
retains access only for the rotating session.

## Staff PIN controls

The staff PIN accepts 4–12 decimal digits. PostgreSQL hashes it with bcrypt cost 12 through
`pgcrypto`; neither Edge Function logs request bodies, PINs, bearer tokens, or database error
bodies.

The `staff-pin` endpoint permits four failed attempts within a rolling 15-minute window. The
fifth failure blocks that verified Auth user for 15 minutes. A successful PIN clears the
bucket. The function hashes the verified user UUID before storage.

The function deliberately trusts no client address or forwarding header for bucket identity.
Its only trusted request metadata is the bearer identity verified by Supabase Auth and matched
against the token's subject and session claims. Supabase Auth's separate anonymous-sign-in IP
limit constrains creation of replacement anonymous identities.

Every request first presents its bearer token to Supabase Auth. The function accepts the JWT
`session_id` only after Auth verifies the token and its `sub` matches the returned user. The
service-role key remains in the Edge environment and never reaches browser code.

Staff grants expire exactly seven days after issuance. Rotating the PIN increments its
generation, revokes every existing grant, and issues a new seven-day grant only to the session
that performed the authorized rotation.

## Production inputs

Keep these outside source control and supply them through the deployment environment:

- The Supabase project and its database credentials.
- Public browser configuration: project URL and public key.
- Edge runtime service-role configuration.
- The initial staff PIN, provisioned through a secured database session with the same
  bcrypt procedure used locally.

Apply migrations and deploy `staff-pin` and `rotate-pin` only after selecting the intended
company project. Do not place a plaintext PIN, password hash, service-role key, or access token
in a migration, seed file, environment example, command history, or application log.
