-- AR Cleanup Board. The board's page keeps its two shared collections (items:
-- one record per invoice or job the team has worked; notes) as JSON documents,
-- the same shape it used as a claude.ai artifact. The ServiceTitan snapshot it
-- starts from (invoices, jobs, recent payments, payment fixes) is one row in
-- ar_seed. Managers and leadership only: it has customer names and balances.

create table public.ar_docs (
  collection text not null check (collection in ('items', 'notes')),
  id text not null check (id ~ '^[A-Za-z0-9_\-.~:@+]{1,200}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table public.ar_seed (
  key text primary key,
  data jsonb not null,
  as_of text not null default '',
  updated_at timestamptz not null default now()
);

create trigger ar_docs_updated_at before update on public.ar_docs
for each row execute function private.set_updated_at();
create trigger ar_seed_updated_at before update on public.ar_seed
for each row execute function private.set_updated_at();

alter table public.ar_docs enable row level security;
alter table public.ar_seed enable row level security;
revoke all on public.ar_docs, public.ar_seed from public, anon, service_role;
grant select, insert, update, delete on public.ar_docs to authenticated;
grant select, insert, update on public.ar_seed to authenticated;

create policy ar_docs_read on public.ar_docs for select to authenticated
  using (private.can_see('managers'));
create policy ar_docs_insert on public.ar_docs for insert to authenticated
  with check (private.can_see('managers') and updated_by = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy ar_docs_update on public.ar_docs for update to authenticated
  using (private.can_see('managers'))
  with check (private.can_see('managers') and updated_by = lower(coalesce(auth.jwt() ->> 'email', '')));
-- Only notes are ever removed, and only by the person who wrote them or leadership.
create policy ar_docs_delete on public.ar_docs for delete to authenticated
  using (private.can_see('managers') and collection = 'notes'
         and (private.is_admin() or data ->> 'by' = lower(coalesce(auth.jwt() ->> 'email', ''))));

create policy ar_seed_read on public.ar_seed for select to authenticated
  using (private.can_see('managers'));
create policy ar_seed_admin on public.ar_seed for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

alter publication supabase_realtime add table public.ar_docs;
