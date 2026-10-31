-- Postgres treats a pattern as greedy when its first quantifier is greedy, so
-- '<(script|style)[^>]*>.*?</\1>' removed everything between a page's first
-- script and its last one, and the search index came out empty. Strip scripts
-- and styles with patterns whose first quantifier is non-greedy.

create function private.portal_text(p_html text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(p_html, '<script[^>]*?>.*?</script>', ' ', 'gi'),
      '<style[^>]*?>.*?</style>', ' ', 'gi'),
    '<[^>]*?>', ' ', 'g')
$$;

revoke all on function private.portal_text(text) from public, anon;
grant execute on function private.portal_text(text) to authenticated;

drop index public.portal_page_html_search_idx;
alter table public.portal_page_html drop column search;
alter table public.portal_page_html add column search tsvector generated always as (
  to_tsvector('english', left(private.portal_text(html), 200000))
) stored;
create index portal_page_html_search_idx on public.portal_page_html using gin (search);

create or replace function public.portal_search(p_q text) returns table (slug text, rank real, snippet text)
language sql stable security invoker set search_path = '' as $$
  with q as (select websearch_to_tsquery('english', p_q) as tsq)
  select h.slug,
         ts_rank(h.search, q.tsq) as rank,
         ts_headline('english', left(private.portal_text(h.html), 60000), q.tsq,
           'MaxWords=18, MinWords=8, MaxFragments=1, StartSel=<<, StopSel=>>') as snippet
  from public.portal_page_html h, q
  where length(btrim(p_q)) >= 2 and h.search @@ q.tsq
  order by rank desc
  limit 20
$$;
