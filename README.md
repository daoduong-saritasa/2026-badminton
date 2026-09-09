# Badminton tournament

Tournament operations for the company badminton event: setup, group play, live scoring,
knockout progression, staff authorization, and public viewing.

## Local development

You need Node.js, Docker, and npm. Install dependencies and start the disposable Supabase
stack:

~~~sh
npm install
npm exec supabase -- start
npm exec supabase -- db reset
~~~

Provision a local staff PIN through the interactive procedure in
[the deployment guide](docs/deployment.md), then serve the Edge Functions and frontend in
separate terminals:

~~~sh
npm exec supabase -- functions serve
npm run dev
~~~

Supabase Studio runs at the URL printed by `supabase start`. The frontend uses only the local
public API URL and public key; service-role credentials stay in the Edge runtime.

## Verification

Run the project-wide checks and the local integration suite:

~~~sh
npm run typecheck
npm run test:related -- <changed files>
npm exec vitest -- run tests/integration
~~~

The integration suite intentionally fails with startup instructions when the Docker-backed
Supabase services are unavailable. It never falls back or connects to a hosted project.

Regenerate database types after every schema migration:

~~~sh
SUPABASE_TELEMETRY_DISABLED=1 npm exec supabase -- gen types typescript --local > src/lib/database.types.ts
~~~

## Deployment boundary

This repository defines migrations, Edge Functions, and operator procedures. Production
project creation, credentials, the initial PIN, custom domains, and deployment execution
remain separate deployment inputs and are not provisioned from the repository.
