-- ServiceTitan link. The API keys are Supabase Edge Function secrets, never
-- in a table. st_settings holds the non-secret choices (tenant, business unit,
-- inventory location, PO types, the catch-all pricebook item, ship-to).
-- st_log records every call the servicetitan function makes.
create table public.st_settings (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  value jsonb not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
create trigger st_settings_stamp before insert or update on public.st_settings
for each row execute function private.plan_stamp();
create trigger st_settings_updated_at before update on public.st_settings
for each row execute function private.set_updated_at();

create table public.st_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by_email text not null default '',
  action text not null,
  ref text not null default '',
  ok boolean not null,
  detail text not null default ''
);
create index st_log_at_idx on public.st_log (at desc);
create index st_log_ref_idx on public.st_log (ref, at desc);

alter table public.st_settings enable row level security;
alter table public.st_log enable row level security;
revoke all on public.st_settings, public.st_log from public, anon, service_role;
grant select, insert, update on public.st_settings to authenticated;
grant select on public.st_log to authenticated;
grant select, insert, update on public.st_settings, public.st_log to service_role;
grant usage on sequence public.st_log_id_seq to service_role;
create policy st_settings_read on public.st_settings for select to authenticated using (private.can_see('managers'));
create policy st_settings_write on public.st_settings for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy st_log_read on public.st_log for select to authenticated using (private.can_see('managers'));

insert into public.st_settings (key, value) values
  ('tenant_id', '2383607358'::jsonb),
  ('misc_sku_id', '91630620'::jsonb),
  ('stock_type_name', '"Warehouse Supplies"'::jsonb);
