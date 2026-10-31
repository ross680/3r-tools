-- Record each credit match so undoing an upload also takes its credits back off.
-- Deleting an import cascades to its purchase lines, then to these rows, and the
-- trigger reverses the quantity on the purchase line or return-list line.

create table public.credit_matches (
  id uuid primary key default gen_random_uuid(),
  credit_line_id uuid not null references public.purchase_lines (id) on delete cascade,
  purchase_line_id uuid references public.purchase_lines (id) on delete cascade,
  return_line_id uuid references public.return_lines (id) on delete cascade,
  qty numeric(12, 3) not null check (qty > 0),
  doc_number text not null default '',
  created_at timestamptz not null default now(),
  check ((purchase_line_id is null) <> (return_line_id is null))
);
create index credit_matches_credit_idx on public.credit_matches (credit_line_id);
create index credit_matches_purchase_idx on public.credit_matches (purchase_line_id);
create index credit_matches_return_idx on public.credit_matches (return_line_id);

alter table public.credit_matches enable row level security;
revoke all on public.credit_matches from public, anon, service_role;
grant select on public.credit_matches to authenticated;
create policy credit_matches_read on public.credit_matches for select to authenticated
  using (private.is_staff());

create function private.unmatch_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.purchase_line_id is not null then
    update public.purchase_lines set returned_qty = greatest(returned_qty - old.qty, 0)
    where id = old.purchase_line_id;
  elsif old.return_line_id is not null then
    update public.return_lines
    set credited_qty = greatest(credited_qty - old.qty, 0),
        credit_memo = coalesce((
          select string_agg(distinct m.doc_number, ', ')
          from public.credit_matches m
          where m.return_line_id = old.return_line_id and m.id <> old.id), '')
    where id = old.return_line_id;
  end if;
  return old;
end
$$;
revoke all on function private.unmatch_credit() from public, anon, authenticated;

create trigger credit_matches_unmatch after delete on public.credit_matches
for each row execute function private.unmatch_credit();

create or replace function private.match_credits(p_import uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  r record;
  p record;
  left_qty numeric;
  take numeric;
  matched int := 0;
begin
  for c in
    select l.id, l.part, abs(l.qty) as qty, d.vendor_id, d.doc_date, d.doc_number
    from public.purchase_lines l join public.purchase_docs d on d.id = l.doc_id
    where d.import_id = p_import and btrim(l.part) <> ''
      and (l.qty < 0 or d.doc_type = 'credit memo')
    order by d.doc_date, l.line_no
  loop
    left_qty := c.qty;
    -- Return-list lines for this part that went back on or before the credit.
    for r in
      select rl.id, rl.qty - rl.credited_qty as open_qty
      from public.return_lines rl
      join public.purchase_lines pl on pl.id = rl.line_id
      join public.purchase_docs pd on pd.id = pl.doc_id
      where pd.vendor_id = c.vendor_id and upper(pl.part) = upper(c.part)
        and rl.qty > rl.credited_qty and rl.added_at::date <= c.doc_date
      order by rl.added_at
      for update of rl
    loop
      exit when left_qty <= 0;
      take := least(left_qty, r.open_qty);
      update public.return_lines
      set credited_qty = credited_qty + take,
          credit_memo = case when credit_memo = '' then c.doc_number
                             when position(c.doc_number in credit_memo) > 0 then credit_memo
                             else credit_memo || ', ' || c.doc_number end
      where id = r.id;
      insert into public.credit_matches (credit_line_id, return_line_id, qty, doc_number)
      values (c.id, r.id, take, c.doc_number);
      left_qty := left_qty - take;
    end loop;
    -- Whatever is left was returned outside the tool: count it on the purchase line.
    for p in
      select l.id, l.qty - l.returned_qty as open_qty
      from public.purchase_lines l join public.purchase_docs d on d.id = l.doc_id
      where d.vendor_id = c.vendor_id and upper(l.part) = upper(c.part)
        and l.qty > 0 and l.qty > l.returned_qty and d.doc_type <> 'credit memo'
        and d.doc_date <= c.doc_date
      order by d.doc_date desc, l.line_no
      for update of l
    loop
      exit when left_qty <= 0;
      take := least(left_qty, p.open_qty);
      update public.purchase_lines set returned_qty = returned_qty + take where id = p.id;
      insert into public.credit_matches (credit_line_id, purchase_line_id, qty, doc_number)
      values (c.id, p.id, take, c.doc_number);
      left_qty := left_qty - take;
    end loop;
    if left_qty < c.qty then
      matched := matched + 1;
    end if;
  end loop;
  return matched;
end
$$;
