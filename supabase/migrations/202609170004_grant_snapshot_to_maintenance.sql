-- 202609170002 recreated get_tournament_snapshot and revoked it from
-- service_role, which the maintenance reset script needs to read its target.
grant execute on function public.get_tournament_snapshot() to service_role;
