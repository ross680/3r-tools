-- Team Portal: roles, pages, announcements and contacts.
--
-- Roles: staff shows as Team, manager as Manager, admin as Leadership.
-- A page's audience is team (everyone on the list), managers (manager and
-- admin) or leadership (admin). Page HTML lives in its own table so the page
-- list loads without it. Only admins change portal content.

alter table public.app_users drop constraint app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('admin', 'manager', 'staff'));

create function private.can_see(p_audience text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_audience
    when 'team' then private.my_role() is not null
    when 'managers' then coalesce(private.my_role() in ('manager', 'admin'), false)
    when 'leadership' then coalesce(private.my_role() = 'admin', false)
    else false
  end
$$;

revoke all on function private.can_see(text) from public, anon;
grant execute on function private.can_see(text) to authenticated;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

-- Sections and pages ---------------------------------------------------------

create table public.portal_sections (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  title text not null check (btrim(title) <> ''),
  blurb text not null default '',
  sort int not null default 0
);

create table public.portal_pages (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (btrim(title) <> ''),
  blurb text not null default '',
  section text not null references public.portal_sections (key) on update cascade,
  audience text not null default 'team' check (audience in ('team', 'managers', 'leadership')),
  kind text not null default 'page' check (kind in ('page', 'link')),
  url text check (url is null or url ~ '^https://'),
  encrypted boolean not null default false,
  featured boolean not null default false,
  keywords text not null default '',
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((kind = 'link') = (url is not null))
);

create index portal_pages_section_idx on public.portal_pages (section);

create table public.portal_page_html (
  slug text primary key references public.portal_pages (slug) on update cascade on delete cascade,
  html text not null,
  search tsvector generated always as (
    to_tsvector('english', left(regexp_replace(regexp_replace(html, '<(script|style)[^>]*>.*?</\1>', ' ', 'gis'), '<[^>]+>', ' ', 'g'), 200000))
  ) stored,
  updated_at timestamptz not null default now()
);

create index portal_page_html_search_idx on public.portal_page_html using gin (search);

create trigger portal_pages_updated_at before update on public.portal_pages
for each row execute function private.set_updated_at();
create trigger portal_page_html_updated_at before update on public.portal_page_html
for each row execute function private.set_updated_at();

-- Announcements and contacts -------------------------------------------------

create table public.portal_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  body text not null default '',
  audience text not null default 'team' check (audience in ('team', 'managers', 'leadership')),
  pinned boolean not null default false,
  ends_on date,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger portal_announcements_updated_at before update on public.portal_announcements
for each row execute function private.set_updated_at();

create table public.portal_contacts (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('3R Team', 'Tech Support', 'Vendors & Partners', 'Jobsite')),
  name text not null default '',
  title text not null default '',
  company text not null default '',
  category text not null default '',
  phone1 text not null default '',
  phone2 text not null default '',
  email text not null default '',
  address text not null default '',
  website text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(name) <> '' or btrim(company) <> '')
);

create index portal_contacts_section_idx on public.portal_contacts (section);

create trigger portal_contacts_updated_at before update on public.portal_contacts
for each row execute function private.set_updated_at();

-- Access -----------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['portal_sections', 'portal_pages', 'portal_page_html', 'portal_announcements', 'portal_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, service_role', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

create policy portal_sections_read on public.portal_sections for select to authenticated
  using (private.is_staff());
create policy portal_sections_admin on public.portal_sections for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy portal_pages_read on public.portal_pages for select to authenticated
  using (private.is_admin() or (active and private.can_see(audience)));
create policy portal_pages_admin on public.portal_pages for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy portal_page_html_read on public.portal_page_html for select to authenticated
  using (exists (
    select 1 from public.portal_pages p
    where p.slug = portal_page_html.slug
      and (private.is_admin() or (p.active and private.can_see(p.audience)))
  ));
create policy portal_page_html_admin on public.portal_page_html for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy portal_announcements_read on public.portal_announcements for select to authenticated
  using (private.is_admin() or (active and private.can_see(audience)));
create policy portal_announcements_admin on public.portal_announcements for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy portal_contacts_read on public.portal_contacts for select to authenticated
  using (private.is_staff() and (active or private.is_admin()));
create policy portal_contacts_admin on public.portal_contacts for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Full-text search over the pages the caller can open. Runs as the caller, so
-- the read policies above decide what comes back.
create function public.portal_search(p_q text) returns table (slug text, rank real, snippet text)
language sql stable security invoker set search_path = '' as $$
  with q as (select websearch_to_tsquery('english', p_q) as tsq)
  select h.slug,
         ts_rank(h.search, q.tsq) as rank,
         ts_headline('english',
           left(regexp_replace(regexp_replace(h.html, '<(script|style)[^>]*>.*?</\1>', ' ', 'gis'), '<[^>]+>', ' ', 'g'), 60000),
           q.tsq, 'MaxWords=18, MinWords=8, MaxFragments=1, StartSel=<<, StopSel=>>') as snippet
  from public.portal_page_html h, q
  where length(btrim(p_q)) >= 2 and h.search @@ q.tsq
  order by rank desc
  limit 20
$$;

revoke all on function public.portal_search(text) from public, anon;
grant execute on function public.portal_search(text) to authenticated;
