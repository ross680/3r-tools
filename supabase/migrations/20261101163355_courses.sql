-- Courses and progress. Managers and leadership add courses: either lessons with
-- optional quizzes written in 3R Tools, or an existing portal page (the old
-- Google Site courses) that people mark complete. Answer keys sit in their own
-- table that learners can't read; quizzes are graded in course_lesson_done().
-- Progress and completions are written only by the functions below. A person
-- sees their own; managers and leadership see everyone's.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null check (btrim(title) <> ''),
  blurb text not null default '',
  audience text not null default 'team' check (audience in ('team', 'managers', 'leadership')),
  page_slug text references public.portal_pages (slug) on update cascade on delete set null,
  required boolean not null default false,
  pass_pct int not null default 80 check (pass_pct between 0 and 100),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courses_page_idx on public.courses (page_slug);

create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  sort int not null default 0,
  title text not null check (btrim(title) <> ''),
  body text not null default '',
  -- [{"q": "...", "options": ["...", "..."]}], no answers here
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  updated_at timestamptz not null default now()
);
create index course_lessons_course_idx on public.course_lessons (course_id, sort);

create table public.course_lesson_keys (
  lesson_id uuid primary key references public.course_lessons (id) on delete cascade,
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array')
);

create table public.course_progress (
  email text not null,
  course_id uuid not null references public.courses (id) on delete cascade,
  lesson_id uuid not null references public.course_lessons (id) on delete cascade,
  done_at timestamptz,
  score int,
  attempts int not null default 0,
  last_at timestamptz not null default now(),
  primary key (email, lesson_id)
);
create index course_progress_course_idx on public.course_progress (course_id, email);
create index course_progress_lesson_idx on public.course_progress (lesson_id);

create table public.course_completions (
  email text not null,
  course_id uuid not null references public.courses (id) on delete cascade,
  completed_at timestamptz not null default now(),
  how text not null check (how in ('lessons', 'self', 'manager')),
  score int,
  marked_by text not null default '',
  primary key (email, course_id)
);
create index course_completions_course_idx on public.course_completions (course_id);

create trigger courses_updated_at before update on public.courses
for each row execute function private.set_updated_at();
create trigger course_lessons_updated_at before update on public.course_lessons
for each row execute function private.set_updated_at();

alter table public.courses enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_lesson_keys enable row level security;
alter table public.course_progress enable row level security;
alter table public.course_completions enable row level security;
revoke all on public.courses, public.course_lessons, public.course_lesson_keys,
  public.course_progress, public.course_completions from public, anon, service_role;
grant select, insert, update on public.courses to authenticated;
grant select, insert, update, delete on public.course_lessons to authenticated;
grant select, insert, update, delete on public.course_lesson_keys to authenticated;
grant select on public.course_progress, public.course_completions to authenticated;

create policy courses_read on public.courses for select to authenticated
  using ((active and private.can_see(audience)) or private.can_see('managers'));
create policy courses_edit on public.courses for insert to authenticated
  with check (private.can_see('managers'));
create policy courses_update on public.courses for update to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

create policy course_lessons_read on public.course_lessons for select to authenticated
  using (exists (select 1 from public.courses c where c.id = course_id
    and ((c.active and private.can_see(c.audience)) or private.can_see('managers'))));
create policy course_lessons_edit on public.course_lessons for all to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

create policy course_lesson_keys_edit on public.course_lesson_keys for all to authenticated
  using (private.can_see('managers')) with check (private.can_see('managers'));

create policy course_progress_read on public.course_progress for select to authenticated
  using (email = private.my_email() or private.can_see('managers'));
create policy course_completions_read on public.course_completions for select to authenticated
  using (email = private.my_email() or private.can_see('managers'));

-- Finish a lesson. A lesson with questions needs p_answers, an array of the
-- chosen option index per question; it counts as done at the course's pass mark.
-- The best score is kept. Finishing every lesson completes the course.
create function public.course_lesson_done(p_lesson uuid, p_answers jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me text := private.my_email();
  l public.course_lessons;
  c public.courses;
  k jsonb;
  n int;
  nright int := 0;
  res jsonb := '[]'::jsonb;
  q_ok boolean;
  sc int;
  passed boolean;
  total int;
  ndone int;
begin
  if private.my_role() is null then
    raise exception 'Sign in to 3R Tools first' using errcode = '42501';
  end if;
  select * into l from public.course_lessons where id = p_lesson;
  if not found then
    raise exception 'That lesson isn''t here' using errcode = 'P0002';
  end if;
  select * into c from public.courses where id = l.course_id and active and private.can_see(audience);
  if not found then
    raise exception 'That course isn''t open to you' using errcode = '42501';
  end if;
  n := jsonb_array_length(l.questions);
  if n = 0 then
    passed := true;
  else
    if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) < n then
      raise exception 'Answer every question' using errcode = '22023';
    end if;
    select answers into k from public.course_lesson_keys where lesson_id = l.id;
    for i in 0 .. n - 1 loop
      q_ok := k is not null and (k -> i) is not null and (p_answers -> i) = (k -> i);
      if q_ok then nright := nright + 1; end if;
      res := res || to_jsonb(q_ok);
    end loop;
    sc := round(100.0 * nright / n);
    passed := sc >= c.pass_pct;
  end if;

  insert into public.course_progress (email, course_id, lesson_id, done_at, score, attempts, last_at)
  values (me, c.id, l.id, case when passed then now() end, sc, case when n > 0 then 1 else 0 end, now())
  on conflict (email, lesson_id) do update set
    done_at = coalesce(public.course_progress.done_at, excluded.done_at),
    score = greatest(public.course_progress.score, excluded.score),
    attempts = public.course_progress.attempts + excluded.attempts,
    last_at = now();

  select count(*) into total from public.course_lessons where course_id = c.id;
  select count(*) into ndone from public.course_progress p
    join public.course_lessons x on x.id = p.lesson_id
    where p.email = me and x.course_id = c.id and p.done_at is not null;
  if total > 0 and ndone >= total then
    insert into public.course_completions (email, course_id, how, score)
    select me, c.id, 'lessons', round(avg(p.score))::int from public.course_progress p
      join public.course_lessons x on x.id = p.lesson_id
      where p.email = me and x.course_id = c.id
    on conflict (email, course_id) do nothing;
  end if;

  return jsonb_build_object('passed', passed, 'score', sc, 'right', nright, 'total', n,
    'results', res, 'course_done', total > 0 and ndone >= total);
end
$$;
revoke all on function public.course_lesson_done(uuid, jsonb) from public, anon;
grant execute on function public.course_lesson_done(uuid, jsonb) to authenticated;

-- Mark a page course (one with no lessons in 3R Tools) as finished.
create function public.course_self_complete(p_course uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.courses;
begin
  if private.my_role() is null then
    raise exception 'Sign in to 3R Tools first' using errcode = '42501';
  end if;
  select * into c from public.courses where id = p_course and active and private.can_see(audience);
  if not found then
    raise exception 'That course isn''t open to you' using errcode = '42501';
  end if;
  if exists (select 1 from public.course_lessons where course_id = c.id) then
    raise exception 'Finish the lessons to complete this course' using errcode = '22023';
  end if;
  insert into public.course_completions (email, course_id, how)
  values (private.my_email(), c.id, 'self')
  on conflict (email, course_id) do nothing;
end
$$;
revoke all on function public.course_self_complete(uuid) from public, anon;
grant execute on function public.course_self_complete(uuid) to authenticated;

-- Managers and leadership: mark someone complete (a class in person, say), or
-- reset them so they take it again. A reset clears their lesson progress too.
create function public.course_set_complete(p_course uuid, p_email text, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare em text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.can_see('managers') then
    raise exception 'Only managers and leadership can do that' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courses where id = p_course) then
    raise exception 'That course isn''t here' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.app_users where email = em) then
    raise exception 'That person isn''t on the 3R Tools list' using errcode = 'P0002';
  end if;
  if p_done then
    insert into public.course_completions (email, course_id, how, marked_by)
    values (em, p_course, 'manager', private.my_email())
    on conflict (email, course_id) do nothing;
  else
    delete from public.course_completions where email = em and course_id = p_course;
    delete from public.course_progress where email = em and course_id = p_course;
  end if;
end
$$;
revoke all on function public.course_set_complete(uuid, text, boolean) from public, anon;
grant execute on function public.course_set_complete(uuid, text, boolean) to authenticated;

-- The course pages already on the portal, as page courses.
insert into public.courses (slug, title, blurb, page_slug, sort)
select v.slug, v.title, v.blurb, v.slug, v.sort
from (values
  ('onboarding', 'Onboarding Course', 'The first course every new hire takes.', 10),
  ('employee-handbook', 'Employee Handbook', 'Read the handbook, then mark it complete.', 20),
  ('safety-sds', 'Safety & SDS', 'Safety basics and where to find SDS sheets.', 30),
  ('servicetitan-basics', 'ServiceTitan Basics', 'Getting around ServiceTitan on a call.', 40),
  ('sales-service-training', 'Sales & Service Training', 'The 3R call flow and presenting options.', 50),
  ('practice-scenarios', 'Practice Scenarios', 'Role-play the calls you will run into.', 60),
  ('hvac-heating-cooling-course', 'HVAC Heating & Cooling Course', 'Heating and cooling systems end to end.', 70),
  ('steam-hydronic-course', 'Steam & Hydronic Course', 'Steam and hot water heating.', 80),
  ('honeywell-resideo-courses', 'Honeywell / Resideo Courses', 'Thermostats and controls.', 90)
) as v (slug, title, blurb, sort)
where exists (select 1 from public.portal_pages p where p.slug = v.slug);
