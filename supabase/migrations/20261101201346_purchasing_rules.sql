-- Purchasing rules for the existing po_orders / po_lines / po_receipts tables.
-- Anyone on the team can make a draft PO and send it for approval. Only
-- managers and leadership approve, reject or mark a PO ordered, and only they
-- change the lines once it's approved. Receiving goes through po_receive(),
-- which records the receipt, adds a stock PO's items to the warehouse and logs
-- the movement for Inventory. The guards follow current_user, so the receive
-- function (which runs as its owner) can do what a person can't do directly.

create function private.po_order_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mgr boolean := private.can_see('managers');
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
revoke all on function private.po_order_guard() from public, anon, authenticated;
create trigger po_orders_guard before update on public.po_orders
for each row execute function private.po_order_guard();

create function private.po_line_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st text; r public.po_lines;
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
  if tg_op = 'INSERT' then new.received := 0; new.over_qty := 0; end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke all on function private.po_line_guard() from public, anon, authenticated;
create trigger po_lines_guard before insert or update or delete on public.po_lines
for each row execute function private.po_line_guard();

-- Receive lines on a PO. p_lines is [{"id": <po_lines.id>, "qty": <number>}].
create function public.po_receive(p_po text, p_lines jsonb, p_slip text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  po public.po_orders;
  x jsonb;
  l public.po_lines;
  q numeric;
  rid uuid;
  nlines int := 0;
  stocked numeric := 0;
  open_left boolean;
begin
  if not private.is_staff() then
    raise exception 'Sign in to 3R Tools first' using errcode = '42501';
  end if;
  select * into po from public.po_orders where id = p_po for update;
  if not found then raise exception 'That PO isn''t here' using errcode = 'P0002'; end if;
  if po.status not in ('Approved', 'Ordered') then
    raise exception 'Only an approved or ordered PO can be received' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Nothing to receive' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p_lines) loop
    q := nullif(x ->> 'qty', '')::numeric;
    if q is null or q = 0 then continue; end if;
    if q < 0 then raise exception 'Received amounts can''t be negative' using errcode = '22023'; end if;
    select * into l from public.po_lines where id = (x ->> 'id')::uuid and po_id = po.id for update;
    if not found then raise exception 'A line isn''t on this PO' using errcode = 'P0002'; end if;
    insert into public.po_receipts (po_line_id, qty, packing_slip) values (l.id, q, coalesce(p_slip, '')) returning id into rid;
    update public.po_lines set received = received + q,
      over_qty = greatest(0, received + q - qty)
      where id = l.id;
    nlines := nlines + 1;
    if lower(po.job) = 'stock' and l.item_id is not null then
      insert into public.inv_stock (location_id, line_key, item_id, on_hand, updated_at)
      values ('W', l.item_id, l.item_id, q, now())
      on conflict (location_id, line_key) do update set on_hand = coalesce(public.inv_stock.on_hand, 0) + q, updated_at = now();
      insert into public.inv_movements (type, item_id, to_loc, qty, job, ref, note, client_key)
      values ('Receive', l.item_id, 'W', q, po.job, po.id, coalesce(p_slip, ''), 'rcv-' || rid::text);
      stocked := stocked + q;
    end if;
  end loop;
  if nlines = 0 then raise exception 'Enter how many came in' using errcode = '22023'; end if;
  select exists (select 1 from public.po_lines where po_id = po.id and received + closed_short_qty < qty) into open_left;
  update public.po_orders set
    status = case when open_left then 'Ordered' else 'Received' end,
    ordered_at = coalesce(ordered_at, now()),
    received_at = case when open_left then received_at else now() end
    where id = po.id;
  return jsonb_build_object('lines', nlines, 'stocked', stocked, 'complete', not open_left);
end
$$;
revoke all on function public.po_receive(text, jsonb, text) from public, anon;
grant execute on function public.po_receive(text, jsonb, text) to authenticated;
