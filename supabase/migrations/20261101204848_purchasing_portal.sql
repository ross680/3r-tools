-- What the old Warehouse & Purchasing portal had that 3R Tools didn't yet:
-- an approval limit for managers (above it, leadership approves), and a link
-- from a PO line to the parts request it came from.

create table public.po_settings (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  value numeric not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
create trigger po_settings_stamp before insert or update on public.po_settings
for each row execute function private.plan_stamp();
create trigger po_settings_updated_at before update on public.po_settings
for each row execute function private.set_updated_at();
alter table public.po_settings enable row level security;
revoke all on public.po_settings from public, anon, service_role;
grant select, insert, update on public.po_settings to authenticated;
create policy po_settings_read on public.po_settings for select to authenticated using (private.is_staff());
create policy po_settings_write on public.po_settings for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
insert into public.po_settings (key, value) values ('manager_approval_limit', 1000);

alter table public.po_lines add column request_id uuid references public.requests (id) on delete set null;
create index po_lines_request_idx on public.po_lines (request_id);

-- A manager approves or orders a PO only up to the limit; leadership has no limit.
create or replace function private.po_order_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  mgr boolean := private.can_see('managers');
  lim numeric;
  tot numeric;
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.status is distinct from old.status then
    if new.status = 'Received' then
      raise exception 'Receive the lines to mark a PO received' using errcode = '42501';
    end if;
    if new.status in ('Approved', 'Ordered', 'Rejected') and not mgr then
      raise exception 'Only managers and leadership approve or order a PO' using errcode = '42501';
    end if;
    if old.status in ('Approved', 'Ordered', 'Received', 'Canceled') and not mgr then
      raise exception 'Only managers and leadership change a PO once it''s approved' using errcode = '42501';
    end if;
    if new.status in ('Approved', 'Ordered') and old.status not in ('Approved', 'Ordered') and not private.is_admin() then
      select value into lim from public.po_settings where key = 'manager_approval_limit';
      select coalesce(sum(qty * unit_cost), 0) into tot from public.po_lines where po_id = new.id;
      if lim is not null and tot > lim then
        raise exception 'This PO is over the % approval limit, so leadership approves it', to_char(lim, 'FM$999,999,990') using errcode = '42501';
      end if;
    end if;
    if new.status = 'Approved' then
      new.approved_by := private.me(); new.approved_at := now();
    elsif new.status = 'Ordered' then
      new.ordered_at := coalesce(new.ordered_at, now());
      if new.approved_at is null then new.approved_by := private.me(); new.approved_at := now(); end if;
      new.sent_by := private.me(); new.sent_at := coalesce(new.sent_at, now());
    end if;
  else
    if old.status not in ('Draft', 'Pending', 'Rejected') and not mgr then
      raise exception 'Only managers and leadership change a PO once it''s approved' using errcode = '42501';
    end if;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  new.requested_by := old.requested_by;
  new.received_at := old.received_at;
  return new;
end
$$;

-- The same limit when a manager changes the lines of an approved PO.
create or replace function private.po_line_guard() returns trigger
language plpgsql set search_path = '' as $$
declare st text; r public.po_lines; lim numeric; tot numeric;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  r := case when tg_op = 'DELETE' then old else new end;
  select status into st from public.po_orders where id = r.po_id;
  if st not in ('Draft', 'Pending', 'Rejected') and not private.can_see('managers') then
    raise exception 'Only managers and leadership change the lines once a PO is approved' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.received is distinct from old.received or new.over_qty is distinct from old.over_qty) then
    raise exception 'Use Receive to record what came in' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and st in ('Approved', 'Ordered') and not private.is_admin() then
    select value into lim from public.po_settings where key = 'manager_approval_limit';
    select coalesce(sum(qty * unit_cost), 0) into tot from public.po_lines where po_id = r.po_id and id <> r.id;
    if lim is not null and tot + new.qty * new.unit_cost > lim then
      raise exception 'That takes the PO over the % approval limit, so leadership changes it', to_char(lim, 'FM$999,999,990') using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' then new.received := 0; new.over_qty := 0; end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
