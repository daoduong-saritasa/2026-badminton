# Deployment

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
