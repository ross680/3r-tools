-- Rename purchase_intake's variables so none shares a name with a column or an
-- alias: "x" clashed with the row alias in its grouping query, and total, part
-- and ext are also column names.

create or replace function public.purchase_intake(p_key text, p_payload jsonb) returns jsonb
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
  docs int := 0; nlines int := 0; tot numeric := 0;
  skipped jsonb := '[]'::jsonb;
  matched int := 0;
  r jsonb;
  q numeric; u numeric; amt numeric; cat text; pnum text; ln int;
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
    select lower(btrim(coalesce(e ->> 'doc_type', p_payload ->> 'doc_type', 'invoice'))) as doc_type,
           btrim(coalesce(e ->> 'vendor', '')) as vendor,
           btrim(coalesce(e ->> 'invoice_number', '')) as num,
           min(nullif(btrim(coalesce(e ->> 'invoice_date', '')), '')) as dt,
           max(btrim(coalesce(e ->> 'job_or_po', ''))) as job,
           jsonb_agg(e) as items
    from jsonb_array_elements(rows) e
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
      amt := nullif(regexp_replace(coalesce(r ->> 'extended', ''), '[^0-9.\-]', '', 'g'), '')::numeric;
      if q is null and amt is null then continue; end if;
      q := coalesce(q, 0);
      if u is null and amt is not null and q <> 0 then u := round(amt / q, 4); end if;
      u := abs(coalesce(u, 0));
      if amt is null then amt := round(q * u, 2); end if;
      -- Prices printed per 100 or per 1,000.
      if q <> 0 and abs(u * q - amt) > greatest(0.02 * abs(amt), 0.05) then
        if abs(u / 100 * q - amt) <= greatest(0.02 * abs(amt), 0.05) then u := round(u / 100, 4);
        elsif abs(u / 1000 * q - amt) <= greatest(0.02 * abs(amt), 0.05) then u := round(u / 1000, 4);
        end if;
      end if;
      if d.doc_type = 'credit memo' then q := -abs(q); amt := -abs(amt); end if;
      pnum := btrim(coalesce(r ->> 'part_number', ''));
      cat := null;
      select c.name into cat from public.categories c where lower(c.name) = lower(btrim(coalesce(r ->> 'category', '')));
      if cat is null and pnum <> '' then
        select l.category into cat from public.purchase_lines l join public.purchase_docs pd on pd.id = l.doc_id
        where upper(l.part) = upper(pnum) and pd.import_id is distinct from imp order by pd.doc_date desc limit 1;
      end if;
      ln := ln + 1;
      insert into public.purchase_lines (doc_id, line_no, part, description, category, qty, unit_price, ext)
      values (doc_id, ln, pnum, left(btrim(coalesce(r ->> 'description', '')), 500), coalesce(cat, 'Misc / other'), q, u, amt);
      nlines := nlines + 1; tot := tot + amt;
    end loop;
  end loop;

  update public.imports set doc_count = docs, line_count = nlines, total = round(tot, 2) where id = imp;
  if docs = 0 then
    delete from public.imports where id = imp;
  else
    matched := private.match_credits(imp);
  end if;
  return jsonb_build_object('ok', true, 'docs', docs, 'rows', nlines, 'credits_matched', matched, 'skipped', skipped);
end
$$;
