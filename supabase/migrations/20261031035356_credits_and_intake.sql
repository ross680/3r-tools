-- 1. A credit memo for something already on a return list is tied to that list
--    line instead of being counted again on the purchase line.
-- 2. purchase_intake(key, payload): Zapier posts the lines it read from a vendor
--    invoice or credit memo PDF. Each key is stored as a hash; an admin makes one
--    from the Add purchases tab.

alter table public.return_lines
  add column credited_qty numeric(12, 3) not null default 0 check (credited_qty >= 0),
  add column credit_memo text not null default '';

-- The matching itself, shared by the admin upload and the intake.
create function private.match_credits(p_import uuid) returns int
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
      left_qty := left_qty - take;
    end loop;
    if left_qty < c.qty then
      matched := matched + 1;
    end if;
  end loop;
  return matched;
end
$$;
revoke all on function private.match_credits(uuid) from public, anon, authenticated;

create or replace function public.match_credit_lines(p_import uuid) returns int
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Only an admin can match credits' using errcode = 'insufficient_privilege';
  end if;
  return private.match_credits(p_import);
end
$$;

-- Intake keys -----------------------------------------------------------------

create table private.intake_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  label text not null default '',
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
revoke all on private.intake_keys from public, anon, authenticated;

-- Makes a new key (and turns off the old ones). The key is shown once.
create function public.purchase_intake_new_key(p_label text default 'Zapier') returns text
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  if not private.is_admin() then
    raise exception 'Only an admin can make an intake key' using errcode = 'insufficient_privilege';
  end if;
  k := 'rg_' || encode(extensions.gen_random_bytes(24), 'hex');
  update private.intake_keys set revoked_at = now() where revoked_at is null;
  insert into private.intake_keys (key_hash, label, created_by_email)
  values (encode(extensions.digest(k, 'sha256'), 'hex'), coalesce(p_label, ''), lower(coalesce(auth.jwt() ->> 'email', '')));
  return k;
end
$$;
revoke all on function public.purchase_intake_new_key(text) from public, anon;
grant execute on function public.purchase_intake_new_key(text) to authenticated;

create function public.purchase_intake_status() returns table (label text, created_at timestamptz, created_by_email text, last_used_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.label, k.created_at, k.created_by_email, k.last_used_at
  from private.intake_keys k where k.revoked_at is null and private.is_admin()
  order by k.created_at desc limit 1
$$;
revoke all on function public.purchase_intake_status() from public, anon;
grant execute on function public.purchase_intake_status() to authenticated;

-- The intake ------------------------------------------------------------------
-- Payload: {"source": "...", "doc_type": "...", "rows": [{vendor, invoice_date,
-- invoice_number, doc_type, part_number, description, category, qty, unit_price,
-- extended, job_or_po}]}. Rows may also be a JSON string. Order confirmations
-- and rebate lines are skipped. A document already on file is left alone unless
-- it came from an earlier intake and nothing on a return list points at it.
create function public.purchase_intake(p_key text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  key_id uuid;
  rows jsonb;
  src text := left(coalesce(p_payload ->> 'source', 'Zapier'), 300);
  imp uuid;
  d record;
  v record;
  doc_id uuid;
  existing record;
  docs int := 0; lines int := 0; total numeric := 0;
  skipped jsonb := '[]'::jsonb;
  matched int := 0;
  r jsonb;
  q numeric; u numeric; x numeric; cat text; part text; ln int;
begin
  select id into key_id from private.intake_keys
  where revoked_at is null and key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if key_id is null then
    raise exception 'Intake key not recognized' using errcode = 'invalid_authorization_specification';
  end if;
  update private.intake_keys set last_used_at = now() where id = key_id;

  rows := p_payload -> 'rows';
  if jsonb_typeof(rows) = 'string' then rows := (rows #>> '{}')::jsonb; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No rows in the payload');
  end if;
  if jsonb_array_length(rows) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'Too many rows in one post (2,000 max)');
  end if;

  insert into public.imports (file_name, note, created_by, created_by_email)
  values (src, 'Zapier invoice intake', null, 'zapier') returning id into imp;

  for d in
    select lower(btrim(coalesce(x ->> 'doc_type', p_payload ->> 'doc_type', 'invoice'))) as doc_type,
           btrim(coalesce(x ->> 'vendor', '')) as vendor,
           btrim(coalesce(x ->> 'invoice_number', '')) as num,
           min(nullif(btrim(coalesce(x ->> 'invoice_date', '')), '')) as dt,
           max(btrim(coalesce(x ->> 'job_or_po', ''))) as job,
           jsonb_agg(x) as items
    from jsonb_array_elements(rows) x
    group by 1, 2, 3
  loop
    if d.doc_type not in ('invoice', 'credit memo', 'slip') then
      skipped := skipped || jsonb_build_object('doc', d.num, 'why', 'not an invoice, credit memo or slip: ' || d.doc_type);
      continue;
    end if;
    if d.num = '' or d.dt is null or d.dt !~ '^\d{4}-\d{2}-\d{2}$' then
      skipped := skipped || jsonb_build_object('doc', d.num, 'why', 'missing invoice number or date');
      continue;
    end if;
    v := null;
    select * into v from public.vendors vv
    where lower(vv.name) = lower(d.vendor) or lower(d.vendor) = any (select lower(a) from unnest(vv.aliases) a)
    limit 1;
    if v.id is null then
      skipped := skipped || jsonb_build_object('doc', d.num, 'why', 'vendor not on file: ' || d.vendor);
      continue;
    end if;

    existing := null;
    select pd.id, pd.import_id, i.note,
           exists (select 1 from public.return_lines rl join public.purchase_lines pl on pl.id = rl.line_id where pl.doc_id = pd.id) as on_list
      into existing
    from public.purchase_docs pd left join public.imports i on i.id = pd.import_id
    where pd.vendor_id = v.id and pd.doc_type = d.doc_type and pd.doc_number = d.num;
    if existing.id is not null then
      if coalesce(existing.note, '') <> 'Zapier invoice intake' or existing.on_list then
        skipped := skipped || jsonb_build_object('doc', d.num, 'why', 'already on file');
        continue;
      end if;
      delete from public.purchase_docs where id = existing.id;
    end if;

    insert into public.purchase_docs (vendor_id, doc_number, doc_date, doc_type, job, source, import_id)
    values (v.id, d.num, d.dt::date, d.doc_type, coalesce(d.job, ''), src, imp) returning id into doc_id;
    docs := docs + 1; ln := 0;

    for r in select * from jsonb_array_elements(d.items) loop
      if coalesce(r ->> 'description', '') ~* '(rebate|mass ?save|instant savings)' then continue; end if;
      q := nullif(regexp_replace(coalesce(r ->> 'qty', ''), '[^0-9.\-]', '', 'g'), '')::numeric;
      u := nullif(regexp_replace(coalesce(r ->> 'unit_price', ''), '[^0-9.\-]', '', 'g'), '')::numeric;
      x := nullif(regexp_replace(coalesce(r ->> 'extended', ''), '[^0-9.\-]', '', 'g'), '')::numeric;
      if q is null and x is null then continue; end if;
      q := coalesce(q, 0);
      if u is null and x is not null and q <> 0 then u := round(x / q, 4); end if;
      u := abs(coalesce(u, 0));
      if x is null then x := round(q * u, 2); end if;
      -- Prices printed per 100 or per 1,000.
      if q <> 0 and abs(u * q - x) > greatest(0.02 * abs(x), 0.05) then
        if abs(u / 100 * q - x) <= greatest(0.02 * abs(x), 0.05) then u := round(u / 100, 4);
        elsif abs(u / 1000 * q - x) <= greatest(0.02 * abs(x), 0.05) then u := round(u / 1000, 4);
        end if;
      end if;
      if d.doc_type = 'credit memo' then q := -abs(q); x := -abs(x); end if;
      part := btrim(coalesce(r ->> 'part_number', ''));
      cat := null;
      select c.name into cat from public.categories c where lower(c.name) = lower(btrim(coalesce(r ->> 'category', '')));
      if cat is null and part <> '' then
        select l.category into cat from public.purchase_lines l join public.purchase_docs pd on pd.id = l.doc_id
        where upper(l.part) = upper(part) and pd.import_id is distinct from imp order by pd.doc_date desc limit 1;
      end if;
      ln := ln + 1;
      insert into public.purchase_lines (doc_id, line_no, part, description, category, qty, unit_price, ext)
      values (doc_id, ln, part, left(btrim(coalesce(r ->> 'description', '')), 500), coalesce(cat, 'Misc / other'), q, u, x);
      lines := lines + 1; total := total + x;
    end loop;
  end loop;

  update public.imports set doc_count = docs, line_count = lines, total = round(total, 2) where id = imp;
  if docs = 0 then
    delete from public.imports where id = imp;
  else
    matched := private.match_credits(imp);
  end if;
  return jsonb_build_object('ok', true, 'docs', docs, 'rows', lines, 'credits_matched', matched, 'skipped', skipped);
end
$$;
revoke all on function public.purchase_intake(text, jsonb) from public;
grant execute on function public.purchase_intake(text, jsonb) to anon, authenticated;
