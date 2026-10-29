-- Live updates for the shared return list. Realtime still applies each table's
-- select policy, so only people on app_users receive changes.
alter publication supabase_realtime add table public.return_lines, public.vendors;
