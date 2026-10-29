-- 3R Tools: supply-house purchase history, the return generator, and vendor spend.
-- Everyone signs in with Supabase Auth (email and password). Only emails listed
-- in app_users can read or write anything. Admins import purchases and edit
-- categories; staff build return lists.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- People -------------------------------------------------------------------

create table public.app_users (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.app_users u
  where u.active and u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() is not null
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

revoke all on function private.my_role(), private.is_staff(), private.is_admin() from public, anon;
grant execute on function private.my_role(), private.is_staff(), private.is_admin() to authenticated;

-- Reference lists ----------------------------------------------------------

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  store_credit_only boolean not null default false,
  -- The open return list for this vendor: RA / slip number and status.
  ra text not null default '',
  return_status text not null default 'Building'
    check (return_status in ('Building', 'Sent to vendor', 'Slip received', 'Credit received')),
  created_at timestamptz not null default now()
);

create table public.categories (
  name text primary key check (btrim(name) <> ''),
  sort int not null default 0,
  equipment boolean not null default false,
  created_at timestamptz not null default now()
);

-- Purchases ----------------------------------------------------------------

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '',
  note text not null default '',
  doc_count int not null default 0,
  line_count int not null default 0,
  total numeric(14, 2) not null default 0,
  created_by uuid default auth.uid(),
  created_by_email text default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now()
);

create table public.purchase_docs (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors (id),
  doc_number text not null check (btrim(doc_number) <> ''),
  doc_date date not null,
  doc_type text not null default 'invoice'
    check (doc_type in ('invoice', 'order confirmation', 'slip', 'credit memo')),
  job text not null default '',
  source text not null default '',
  import_id uuid references public.imports (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (vendor_id, doc_type, doc_number)
);
create index purchase_docs_import_idx on public.purchase_docs (import_id);
create index purchase_docs_date_idx on public.purchase_docs (doc_date);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.purchase_docs (id) on delete cascade,
  line_no int not null default 0,
  part text not null default '',
  description text not null default '',
  category text not null default 'Misc / other'
    references public.categories (name) on update cascade,
  qty numeric(12, 3) not null default 0,
  unit_price numeric(14, 4) not null default 0,
  ext numeric(14, 2) not null default 0,
  -- Quantity already credited back by the vendor (from credit memos).
  returned_qty numeric(12, 3) not null default 0 check (returned_qty >= 0),
  note text not null default '',
  legacy_id text unique,
  created_at timestamptz not null default now()
);
create index purchase_lines_doc_idx on public.purchase_lines (doc_id);
create index purchase_lines_category_idx on public.purchase_lines (category);
create index purchase_lines_part_idx on public.purchase_lines (upper(part));

-- Return lists -------------------------------------------------------------

create table public.return_lines (
  id uuid primary key default gen_random_uuid(),
  line_id uuid references public.purchase_lines (id) on delete set null,
  vendor text not null,
  part text not null default '',
  description text not null default '',
  category text not null default '',
  qty numeric(12, 3) not null check (qty > 0),
  unit_price numeric(14, 4) not null default 0,
  invoice text not null default '',
  invoice_date date,
  doc_type text not null default '',
  job text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  slip_qty numeric(12, 3) check (slip_qty is null or slip_qty >= 0),
  ra text not null default '',
  added_by uuid default auth.uid(),
  added_by_name text not null default '',
  added_at timestamptz not null default now(),
  closed_at timestamptz
);
create index return_lines_line_idx on public.return_lines (line_id);
create index return_lines_status_idx on public.return_lines (status, vendor);

-- A purchase line can't go back more times than it was bought, even when two
-- people add it at the same moment.
create function private.guard_return_qty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bought numeric;
  credited numeric;
  listed numeric;
begin
  if new.line_id is null then
    return new;
  end if;
  select l.qty, l.returned_qty into bought, credited
  from public.purchase_lines l where l.id = new.line_id for update;
  select coalesce(sum(r.qty), 0) into listed
  from public.return_lines r where r.line_id = new.line_id and r.id <> new.id;
  if bought is not null and listed + new.qty > bought - credited then
    raise exception 'Only % can still go back on this line', greatest(bought - credited - listed, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function private.guard_return_qty() from public, anon, authenticated;

create trigger return_lines_guard_qty
before insert or update of qty, line_id on public.return_lines
for each row execute function private.guard_return_qty();

-- Credit memos: match each credit line to the most recent earlier purchase of
-- the same part from the same vendor and count it as returned there.
create function public.match_credit_lines(p_import uuid) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  c record;
  p record;
  left_qty numeric;
  take numeric;
  matched int := 0;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can match credits' using errcode = 'insufficient_privilege';
  end if;
  for c in
    select l.id, l.part, abs(l.qty) as qty, d.vendor_id, d.doc_date
    from public.purchase_lines l join public.purchase_docs d on d.id = l.doc_id
    where d.import_id = p_import and btrim(l.part) <> ''
      and (l.qty < 0 or d.doc_type = 'credit memo')
    order by d.doc_date, l.line_no
  loop
    left_qty := c.qty;
    for p in
      select l.id, l.qty - l.returned_qty as open_qty
      from public.purchase_lines l join public.purchase_docs d on d.id = l.doc_id
      where d.vendor_id = c.vendor_id and upper(l.part) = upper(c.part)
        and l.qty > 0 and l.qty > l.returned_qty and d.doc_type <> 'credit memo'
        and d.doc_date <= c.doc_date
      order by d.doc_date desc, l.line_no
    loop
      exit when left_qty <= 0;
      take := least(left_qty, p.open_qty);
      update public.purchase_lines set returned_qty = returned_qty + take where id = p.id;
      left_qty := left_qty - take;
    end loop;
    if left_qty < c.qty then
      matched := matched + 1;
    end if;
  end loop;
  return matched;
end
$$;
revoke all on function public.match_credit_lines(uuid) from public, anon;
grant execute on function public.match_credit_lines(uuid) to authenticated;

-- Access -------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['app_users', 'vendors', 'categories', 'imports', 'purchase_docs', 'purchase_lines', 'return_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, service_role', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_staff())', t || '_read', t);
  end loop;
end
$$;

-- Admins manage people, vendors, categories, and imported purchases.
create policy app_users_admin_write on public.app_users for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy categories_admin_write on public.categories for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy imports_admin_write on public.imports for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy purchase_docs_admin_write on public.purchase_docs for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy purchase_lines_admin_write on public.purchase_lines for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy vendors_admin_insert on public.vendors for insert to authenticated
  with check (private.is_admin());
create policy vendors_admin_delete on public.vendors for delete to authenticated
  using (private.is_admin());

-- Staff set a vendor's RA number and status, and build return lists.
create policy vendors_staff_update on public.vendors for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy return_lines_staff_insert on public.return_lines for insert to authenticated
  with check (private.is_staff() and added_by = auth.uid());
create policy return_lines_staff_update on public.return_lines for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy return_lines_staff_delete on public.return_lines for delete to authenticated
  using (private.is_staff() and status = 'open');

-- Starting lists -----------------------------------------------------------

insert into public.categories (name, sort, equipment) values
  ('Black iron / malleable / steel pipe', 1, false),
  ('Boilers / water heaters', 2, true),
  ('Brass / valves / backflow', 3, false),
  ('Condensate / pads / stands', 4, false),
  ('Copper fittings', 5, false),
  ('Copper pipe / tubing', 6, false),
  ('Ductwork / sheet metal', 7, false),
  ('Electrical / controls / thermostats', 8, false),
  ('Filters / air quality', 9, false),
  ('Galvanized', 10, false),
  ('Gas', 11, false),
  ('HVAC equipment', 12, true),
  ('Hangers / strut / supports', 13, false),
  ('Hydronic accessories', 14, false),
  ('Misc / other', 15, false),
  ('PEX', 16, false),
  ('PVC / DWV / CPVC', 17, false),
  ('ProPress / press fittings', 18, false),
  ('Pumps / circulators', 19, false),
  ('Refrigeration / line sets', 20, false),
  ('Tools / consumables', 21, false),
  ('Venting / flue / combustion air', 22, false);

insert into public.vendors (name, store_credit_only) values
  ('Economy', false), ('FW Webb', false), ('Ferguson', false), ('Homans', true),
  ('Johnstone', false), ('Republic', false), ('Winn', false);

insert into public.app_users (email, name, role)
values ('ross@3rplumbingandmechanical.com', 'Ross', 'admin');
