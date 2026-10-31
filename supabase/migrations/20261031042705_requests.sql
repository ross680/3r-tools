-- Requests: tool or part, time off, weekly vehicle check, bonus submission,
-- training sign-up. Each type routes to one person. A request is seen by the
-- person who sent it, the person it's routed to, and leadership. Status changes
-- and comments go through request_act(), which logs each one.

create table public.request_types (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  title text not null check (btrim(title) <> ''),
  blurb text not null default '',
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  route_to text not null default '',
  needs_approval boolean not null default false,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  type text not null references public.request_types (key) on update cascade,
  title text not null check (btrim(title) <> ''),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'approved', 'denied', 'done', 'cancelled')),
  requested_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  requested_by_name text not null default '',
  assigned_to text not null default '',
  response text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index requests_type_idx on public.requests (type);
create index requests_assigned_idx on public.requests (assigned_to, status);
create index requests_requested_by_idx on public.requests (requested_by, created_at desc);

create table public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  at timestamptz not null default now(),
  by_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  action text not null,
  note text not null default ''
);
create index request_events_request_idx on public.request_events (request_id, at);

create trigger request_types_updated_at before update on public.request_types
for each row execute function private.set_updated_at();
create trigger requests_updated_at before update on public.requests
for each row execute function private.set_updated_at();

create function private.my_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke all on function private.my_email() from public, anon;
grant execute on function private.my_email() to authenticated;

-- New requests: who sent it comes from the sign-in, the routing from the type.
create function private.request_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.requested_by := private.my_email();
  new.status := 'new';
  new.response := '';
  new.closed_at := null;
  select coalesce(nullif(t.route_to, ''), '') into new.assigned_to from public.request_types t where t.key = new.type and t.active;
  if not found then
    raise exception 'That request type isn''t available' using errcode = 'check_violation';
  end if;
  select coalesce(nullif(u.name, ''), u.email) into new.requested_by_name from public.app_users u where u.email = new.requested_by;
  return new;
end
$$;
revoke all on function private.request_defaults() from public, anon, authenticated;
create trigger requests_defaults before insert on public.requests
for each row execute function private.request_defaults();

create function private.request_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.request_events (request_id, by_email, action) values (new.id, new.requested_by, 'sent');
  return new;
end
$$;
revoke all on function private.request_created() from public, anon, authenticated;
create trigger requests_created after insert on public.requests
for each row execute function private.request_created();

create function private.can_see_request(p_requested_by text, p_assigned_to text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff() and (
    p_requested_by = private.my_email() or p_assigned_to = private.my_email() or private.is_admin())
$$;
revoke all on function private.can_see_request(text, text) from public, anon;
grant execute on function private.can_see_request(text, text) to authenticated;

alter table public.request_types enable row level security;
alter table public.requests enable row level security;
alter table public.request_events enable row level security;
revoke all on public.request_types, public.requests, public.request_events from public, anon, service_role;
grant select, insert, update on public.request_types to authenticated;
grant select, insert on public.requests to authenticated;
grant select on public.request_events to authenticated;

create policy request_types_read on public.request_types for select to authenticated
  using (private.is_staff());
create policy request_types_admin on public.request_types for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy requests_read on public.requests for select to authenticated
  using (private.can_see_request(requested_by, assigned_to));
create policy requests_insert on public.requests for insert to authenticated
  with check (private.is_staff());

create policy request_events_read on public.request_events for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_events.request_id
                 and private.can_see_request(r.requested_by, r.assigned_to)));

-- Every change after sending. Actions:
--   comment                anyone who can see it
--   cancel                 the sender, while it's new
--   start, done            the person it's routed to, or leadership
--   approve, deny          the person it's routed to, or leadership
--   assign (p_assign)      leadership
--   reopen                 the person it's routed to, or leadership
create function public.request_act(p_id uuid, p_action text, p_note text default '', p_assign text default null)
returns public.requests
language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  me text := private.my_email();
  handler boolean;
  next_status text;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null or not private.can_see_request(r.requested_by, r.assigned_to) then
    raise exception 'Request not found' using errcode = 'no_data_found';
  end if;
  handler := (r.assigned_to = me or private.is_admin());
  p_note := left(btrim(coalesce(p_note, '')), 4000);

  if p_action = 'comment' then
    if p_note = '' then raise exception 'Write a comment first' using errcode = 'check_violation'; end if;
  elsif p_action = 'cancel' then
    if r.requested_by <> me or r.status <> 'new' then
      raise exception 'Only the person who sent it can cancel, and only before it''s picked up' using errcode = 'insufficient_privilege';
    end if;
    next_status := 'cancelled';
  elsif p_action in ('start', 'done', 'approve', 'deny', 'reopen') then
    if not handler then
      raise exception 'Only the person it''s routed to, or leadership, can do that' using errcode = 'insufficient_privilege';
    end if;
    next_status := case p_action when 'start' then 'in_progress' when 'done' then 'done'
                   when 'approve' then 'approved' when 'deny' then 'denied' else 'new' end;
  elsif p_action = 'assign' then
    if not private.is_admin() then
      raise exception 'Only leadership can reassign a request' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from public.app_users u where u.email = lower(btrim(coalesce(p_assign, ''))) and u.active) then
      raise exception 'That person isn''t on the 3R Tools list' using errcode = 'check_violation';
    end if;
    update public.requests set assigned_to = lower(btrim(p_assign)) where id = p_id returning * into r;
    insert into public.request_events (request_id, by_email, action, note) values (p_id, me, 'assigned', lower(btrim(p_assign)));
    return r;
  else
    raise exception 'Unknown action' using errcode = 'check_violation';
  end if;

  if next_status is not null then
    update public.requests
    set status = next_status,
        response = case when p_note <> '' and p_action in ('approve', 'deny', 'done') then p_note else response end,
        closed_at = case when next_status in ('done', 'denied', 'cancelled', 'approved') then now() else null end
    where id = p_id returning * into r;
  end if;
  insert into public.request_events (request_id, by_email, action, note) values (p_id, me, p_action, p_note);
  return r;
end
$$;
revoke all on function public.request_act(uuid, text, text, text) from public, anon;
grant execute on function public.request_act(uuid, text, text, text) to authenticated;

alter publication supabase_realtime add table public.requests;

insert into public.request_types (key, title, blurb, route_to, needs_approval, sort, fields) values
('tool', 'Tool or part', 'Ask for a tool or part for your truck or a job.', 'marc@3rplumbingandmechanical.com', false, 1,
 '[{"k":"item","l":"What do you need?","t":"text","req":true},{"k":"qty","l":"How many","t":"number"},{"k":"job","l":"Job # (if it''s for a job)","t":"text"},{"k":"needed_by","l":"Needed by","t":"date"},{"k":"truck","l":"Truck","t":"text"},{"k":"note","l":"Anything else","t":"textarea"}]'),
('time_off', 'Time off', 'Vacation, sick or personal time.', 'julia@3rplumbingandmechanical.com', true, 2,
 '[{"k":"start","l":"First day off","t":"date","req":true},{"k":"end","l":"Last day off","t":"date","req":true},{"k":"kind","l":"Type","t":"select","o":["Vacation","Sick","Personal","Unpaid"],"req":true},{"k":"hours","l":"Hours (if part of a day)","t":"number"},{"k":"note","l":"Note","t":"textarea"}]'),
('vehicle', 'Weekly vehicle check', 'Friday truck check: mileage, oil and anything wrong.', 'marc@3rplumbingandmechanical.com', false, 3,
 '[{"k":"truck","l":"Truck","t":"text","req":true},{"k":"mileage","l":"Mileage","t":"number","req":true},{"k":"oil_due","l":"Next oil change due at (miles)","t":"number"},{"k":"tires","l":"Tires","t":"select","o":["OK","Needs attention"],"req":true},{"k":"lights","l":"Lights and signals","t":"select","o":["OK","Needs attention"],"req":true},{"k":"fluids","l":"Fluids","t":"select","o":["OK","Needs attention"],"req":true},{"k":"damage","l":"New damage","t":"select","o":["None","Yes, described below"],"req":true},{"k":"issues","l":"Anything wrong or coming due","t":"textarea"}]'),
('bonus', 'Bonus submission', 'Send a completed job in for bonus review.', 'julia@3rplumbingandmechanical.com', true, 4,
 '[{"k":"job","l":"Job #","t":"text","req":true},{"k":"customer","l":"Customer","t":"text"},{"k":"job_type","l":"Job type","t":"select","o":["Service","Install","Maintenance","Sales"],"req":true},{"k":"sold","l":"Sold amount ($)","t":"number"},{"k":"techs","l":"Techs on the job","t":"text"},{"k":"note","l":"Notes for review","t":"textarea"}]'),
('training', 'Training sign-up', 'Sign up for a class: FW Webb, Ferguson, FIA, Emerson Swan or others.', 'julia@3rplumbingandmechanical.com', false, 5,
 '[{"k":"class","l":"Class","t":"text","req":true},{"k":"date","l":"Date","t":"date"},{"k":"where","l":"Where","t":"text"},{"k":"note","l":"Note","t":"textarea"}]');
