-- On-call rotation and Who to Call. The rotation is a list of people (managers
-- and techs; an assisted tech is paired with a senior tech) and one row per
-- week. Who to Call is a list of issues: who owns each, who to escalate to,
-- and any outside company to call. Everyone reads both; managers and
-- leadership edit. Names and numbers are loaded as data, not in this file.

create table public.oncall_people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  kind text not null check (kind in ('manager', 'tech')),
  assisted boolean not null default false,
  contact_id uuid references public.portal_contacts (id) on delete set null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index oncall_people_contact_idx on public.oncall_people (contact_id);

create table public.oncall_weeks (
  week_start date primary key check (extract(isodow from week_start) = 1),
  manager_id uuid references public.oncall_people (id) on delete set null,
  tech_id uuid references public.oncall_people (id) on delete set null,
  assist_id uuid references public.oncall_people (id) on delete set null,
  note text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
create index oncall_weeks_manager_idx on public.oncall_weeks (manager_id);
create index oncall_weeks_tech_idx on public.oncall_weeks (tech_id);
create index oncall_weeks_assist_idx on public.oncall_weeks (assist_id);

create table public.callmap (
  id uuid primary key default gen_random_uuid(),
  area text not null check (btrim(area) <> ''),
  issue text not null check (btrim(issue) <> ''),
  owner text not null default '',
  escalate text not null default '',
  outside text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger oncall_people_updated_at before update on public.oncall_people
for each row execute function private.set_updated_at();
create trigger oncall_weeks_updated_at before update on public.oncall_weeks
for each row execute function private.set_updated_at();
create trigger callmap_updated_at before update on public.callmap
for each row execute function private.set_updated_at();
create trigger oncall_weeks_stamp before insert or update on public.oncall_weeks
for each row execute function private.plan_stamp();

alter table public.oncall_people enable row level security;
alter table public.oncall_weeks enable row level security;
alter table public.callmap enable row level security;
revoke all on public.oncall_people, public.oncall_weeks, public.callmap from public, anon, service_role;
grant select, insert, update on public.oncall_people, public.callmap to authenticated;
grant select, insert, update, delete on public.oncall_weeks to authenticated;

create policy oncall_people_read on public.oncall_people for select to authenticated using (private.is_staff());
create policy oncall_people_write on public.oncall_people for insert to authenticated with check (private.can_see('managers'));
create policy oncall_people_update on public.oncall_people for update to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

create policy oncall_weeks_read on public.oncall_weeks for select to authenticated using (private.is_staff());
create policy oncall_weeks_write on public.oncall_weeks for all to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

create policy callmap_read on public.callmap for select to authenticated using (private.is_staff());
create policy callmap_write on public.callmap for insert to authenticated with check (private.can_see('managers'));
create policy callmap_update on public.callmap for update to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));
