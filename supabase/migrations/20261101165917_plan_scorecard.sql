-- Road to $5M scorecard. Each measure has a monthly target, which leadership
-- sets, and a monthly actual, which managers and leadership enter until the
-- ServiceTitan sync fills it in. Everyone on the team can read it.

create table public.plan_metrics (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  title text not null check (btrim(title) <> ''),
  unit text not null default 'count' check (unit in ('count', 'money', 'pct', 'rating')),
  better text not null default 'up' check (better in ('up', 'down')),
  -- how a year adds up: sum the months, average them, or take the latest month
  roll text not null default 'sum' check (roll in ('sum', 'avg', 'last')),
  now_note text not null default '',
  why text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.plan_targets (
  metric_key text not null references public.plan_metrics (key) on update cascade on delete cascade,
  month date not null check (extract(day from month) = 1),
  target numeric not null,
  updated_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_at timestamptz not null default now(),
  primary key (metric_key, month)
);

create table public.plan_actuals (
  metric_key text not null references public.plan_metrics (key) on update cascade on delete cascade,
  month date not null check (extract(day from month) = 1),
  actual numeric not null,
  source text not null default 'manual' check (source in ('manual', 'servicetitan', 'hustl')),
  note text not null default '',
  updated_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_at timestamptz not null default now(),
  primary key (metric_key, month)
);

create trigger plan_metrics_updated_at before update on public.plan_metrics
for each row execute function private.set_updated_at();
create trigger plan_targets_updated_at before update on public.plan_targets
for each row execute function private.set_updated_at();
create trigger plan_actuals_updated_at before update on public.plan_actuals
for each row execute function private.set_updated_at();

-- Whoever saves a row is recorded from the sign-in, not from the request.
create function private.plan_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := private.my_email();
  return new;
end
$$;
revoke all on function private.plan_stamp() from public, anon, authenticated;
create trigger plan_targets_stamp before insert or update on public.plan_targets
for each row execute function private.plan_stamp();
create trigger plan_actuals_stamp before insert or update on public.plan_actuals
for each row execute function private.plan_stamp();

alter table public.plan_metrics enable row level security;
alter table public.plan_targets enable row level security;
alter table public.plan_actuals enable row level security;
revoke all on public.plan_metrics, public.plan_targets, public.plan_actuals from public, anon, service_role;
grant select, insert, update on public.plan_metrics to authenticated;
grant select, insert, update, delete on public.plan_targets, public.plan_actuals to authenticated;

create policy plan_metrics_read on public.plan_metrics for select to authenticated
  using (private.is_staff());
create policy plan_metrics_write on public.plan_metrics for insert to authenticated
  with check (private.is_admin());
create policy plan_metrics_update on public.plan_metrics for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy plan_targets_read on public.plan_targets for select to authenticated
  using (private.is_staff());
create policy plan_targets_write on public.plan_targets for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy plan_actuals_read on public.plan_actuals for select to authenticated
  using (private.is_staff());
create policy plan_actuals_write on public.plan_actuals for all to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

-- The 2027 plan from the Road to $5M page.
insert into public.plan_metrics (key, title, unit, better, roll, now_note, why, sort) values
  ('revenue', 'Revenue', 'money', 'up', 'sum', '$2.80M in 2026', '$5M for the year.', 10),
  ('paid_jobs', 'Paid jobs', 'count', 'up', 'sum', 'About 72 a month', '$5M means about 102 paid jobs a month.', 20),
  ('avg_ticket', 'Average paid ticket', 'money', 'up', 'avg', '$3,911', 'Service $1,700, install $11,700.', 30),
  ('memberships_active', 'Active memberships', 'count', 'up', 'last', '25 active', '100 by Dec 31, 2026, then 20 new a month.', 40),
  ('memberships_new', 'New memberships', 'count', 'up', 'sum', '', 'Offer a membership on every call.', 50),
  ('reviews', 'Google reviews', 'count', 'up', 'sum', '153 in 2026 (4.82★)', 'Ask for a review before leaving.', 60),
  ('booking_rate', 'Booking rate', 'pct', 'up', 'avg', '71.6%', 'Book 8 of every 10 lead calls.', 70),
  ('close_rate', 'Big-ticket close rate', 'pct', 'up', 'avg', '52%', 'Three options with financing; follow up within 48 hours.', 80),
  ('cancel_rate', 'Cancellations', 'pct', 'down', 'avg', '16.4%', 'Confirm appointments.', 90),
  ('callback_rate', 'Callbacks', 'pct', 'down', 'avg', '3.6% YTD (Oct 9.8%)', 'Under 5% every month, stretch under 3%.', 100),
  ('estimates_open', 'Estimates never followed up', 'count', 'down', 'last', '187 of 331 unsold', 'Call every estimate at 2, 7 and 30 days.', 110),
  ('techs', 'Productive techs', 'count', 'up', 'avg', 'About 5.6', 'About 8.5 on average, with 3 new hires.', 120);

insert into public.plan_targets (metric_key, month, target)
select m.key, d::date,
  case m.key
    when 'revenue' then 416667
    when 'paid_jobs' then 102
    when 'avg_ticket' then 4075
    when 'memberships_active' then 100 + 20 * extract(month from d)
    when 'memberships_new' then 20
    when 'reviews' then 30
    when 'booking_rate' then 80
    when 'close_rate' then 58
    when 'cancel_rate' then 12
    when 'callback_rate' then 5
    when 'estimates_open' then 0
    when 'techs' then 8.5
  end
from public.plan_metrics m
cross join generate_series('2027-01-01'::date, '2027-12-01'::date, interval '1 month') d;
