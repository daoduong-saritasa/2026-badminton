# Badminton tournament

Tournament operations for the company badminton event: setup, group play, live scoring,
knockout progression, staff authorization, and public viewing.

## What you must provision

You do not need a hosted Supabase project to build or review the code. Create and connect the
company-owned Supabase project only when you are ready to deploy:

1. Create the Supabase project and enable anonymous sign-ins.
2. Link this repository to that project and publish the checked-in migrations and Edge
   Functions.
3. Provision the initial staff PIN through a secured database session.
4. Create the company-owned Cloudflare Pages project and add the two public Supabase build
   variables.

The exact commands, account settings, license checks, and smoke procedure are in
[the deployment guide](docs/deployment.md). Nothing in this repository creates an external
account or deploys automatically.

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

Copy the local API URL and public key printed by `supabase start` into an untracked `.env.local`
using `.env.example` as the template. Supabase Studio runs at the URL printed by the same
command. Service-role credentials stay in the Edge runtime.

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
