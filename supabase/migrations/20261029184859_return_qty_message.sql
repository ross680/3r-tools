-- Show "Only 2 can still go back" instead of "Only 2.000".
create or replace function private.guard_return_qty() returns trigger
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
    raise exception 'Only % can still go back on this line', trim_scale(greatest(bought - credited - listed, 0))
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
