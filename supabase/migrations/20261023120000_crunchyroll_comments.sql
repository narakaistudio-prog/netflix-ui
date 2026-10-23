-- Crunchyroll page ke episode-wise comments (Task 13).
--
-- Kyun RPC + SECURITY DEFINER: browser se direct `insert into cr_comments`
-- allowed hota to koi bhi apna `user_id`/`author_name` forge kar sakta tha.
-- Isliye table par koi insert policy nahi hai — likhna sirf in functions se
-- hota hai, jo `auth.uid()` khud padhte hain. Guest (anon) sirf padh sakta hai.
--
-- Deploy: Supabase project `wavzzkbemvujvgdaczqq` (region ap-south-1).

create table if not exists public.cr_comments (
  id uuid primary key default gen_random_uuid(),
  show_key text not null,
  season integer not null default 1,
  episode integer not null default 1,
  parent_id uuid references public.cr_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Anime fan',
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now()
);

create index if not exists cr_comments_episode_idx
  on public.cr_comments (show_key, season, episode, created_at desc);

create table if not exists public.cr_comment_votes (
  comment_id uuid not null references public.cr_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.cr_comments enable row level security;
alter table public.cr_comment_votes enable row level security;

-- Panel bina sign-in bhi dikhna chahiye, isliye read sabke liye open hai.
drop policy if exists cr_comments_read on public.cr_comments;
create policy cr_comments_read on public.cr_comments for select using (true);

drop policy if exists cr_votes_read on public.cr_comment_votes;
create policy cr_votes_read on public.cr_comment_votes for select using (true);

-- Apna comment hi delete ho sakta hai; insert/update ke liye koi policy nahi
-- (matlab browser se seedha write band).
drop policy if exists cr_comments_delete_own on public.cr_comments;
create policy cr_comments_delete_own on public.cr_comments for delete using (user_id = auth.uid());

grant select, delete on public.cr_comments to anon, authenticated;
grant select on public.cr_comment_votes to anon, authenticated;

-- Display name signup ke user_metadata se, warna email ka pehla hissa.
create or replace function public.cr_comment_author()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
    split_part(nullif(u.email, ''), '@', 1),
    'Anime fan'
  )
  from auth.users u
  where u.id = auth.uid();
$$;

create or replace function public.cr_add_comment(
  p_show_key text,
  p_season integer,
  p_episode integer,
  p_body text,
  p_parent uuid default null
) returns public.cr_comments
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.cr_comments;
begin
  if v_uid is null then
    raise exception 'SIGN_IN_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_body) < 2 then
    raise exception 'COMMENT_TOO_SHORT';
  end if;
  if char_length(v_body) > 1200 then
    raise exception 'COMMENT_TOO_LONG';
  end if;
  if p_parent is not null and not exists (select 1 from public.cr_comments c where c.id = p_parent) then
    raise exception 'PARENT_NOT_FOUND';
  end if;
  insert into public.cr_comments (show_key, season, episode, parent_id, user_id, author_name, body)
  values (
    coalesce(nullif(btrim(p_show_key), ''), 'unknown'),
    greatest(coalesce(p_season, 1), 1),
    greatest(coalesce(p_episode, 1), 1),
    p_parent,
    v_uid,
    coalesce(public.cr_comment_author(), 'Anime fan'),
    v_body
  )
  returning * into v_row;
  return v_row;
end;
$$;

-- Top = score (like - dislike), Newest/Oldest = time. `mine` aur `my_vote`
-- panel ko batate hain ki kaunsa comment apna hai aur kaun sa vote laga hua hai.
create or replace function public.cr_list_comments(
  p_show_key text,
  p_season integer,
  p_episode integer,
  p_sort text default 'top'
) returns table (
  id uuid,
  parent_id uuid,
  author_name text,
  body text,
  created_at timestamptz,
  mine boolean,
  like_count integer,
  dislike_count integer,
  my_vote integer
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    c.id,
    c.parent_id,
    c.author_name,
    c.body,
    c.created_at,
    (c.user_id = auth.uid()) as mine,
    coalesce(sum(case when v.value = 1 then 1 else 0 end), 0)::int as like_count,
    coalesce(sum(case when v.value = -1 then 1 else 0 end), 0)::int as dislike_count,
    coalesce(max(case when v.user_id = auth.uid() then v.value end), 0)::int as my_vote
  from public.cr_comments c
  left join public.cr_comment_votes v on v.comment_id = c.id
  where c.show_key = coalesce(p_show_key, '')
    and c.season = greatest(coalesce(p_season, 1), 1)
    and c.episode = greatest(coalesce(p_episode, 1), 1)
  group by c.id
  order by
    case when p_sort = 'old' then extract(epoch from c.created_at) else 0 end asc,
    case when p_sort = 'top'
      then coalesce(sum(case when v.value = 1 then 1 else 0 end), 0)
         - coalesce(sum(case when v.value = -1 then 1 else 0 end), 0)
      else 0 end desc,
    case when p_sort = 'old' then 0 else extract(epoch from c.created_at) end desc;
$$;

-- Wahi button dobara dabane par vote hat jata hai (toggle), isliye ek hi RPC.
create or replace function public.cr_vote_comment(p_comment_id uuid, p_value integer)
returns table (like_count integer, dislike_count integer, my_vote integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_current integer;
begin
  if v_uid is null then
    raise exception 'SIGN_IN_REQUIRED' using errcode = '28000';
  end if;
  if p_value not in (-1, 1) then
    raise exception 'BAD_VOTE';
  end if;
  if not exists (select 1 from public.cr_comments c where c.id = p_comment_id) then
    raise exception 'COMMENT_NOT_FOUND';
  end if;
  select value into v_current
  from public.cr_comment_votes
  where comment_id = p_comment_id and user_id = v_uid;

  if v_current is null then
    insert into public.cr_comment_votes (comment_id, user_id, value)
    values (p_comment_id, v_uid, p_value);
  elsif v_current = p_value then
    delete from public.cr_comment_votes where comment_id = p_comment_id and user_id = v_uid;
  else
    update public.cr_comment_votes set value = p_value
    where comment_id = p_comment_id and user_id = v_uid;
  end if;

  return query
    select
      coalesce(sum(case when v.value = 1 then 1 else 0 end), 0)::int,
      coalesce(sum(case when v.value = -1 then 1 else 0 end), 0)::int,
      coalesce(max(case when v.user_id = v_uid then v.value end), 0)::int
    from public.cr_comment_votes v
    where v.comment_id = p_comment_id;
end;
$$;

create or replace function public.cr_comment_count(p_show_key text, p_season integer, p_episode integer)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.cr_comments
  where show_key = coalesce(p_show_key, '')
    and season = greatest(coalesce(p_season, 1), 1)
    and episode = greatest(coalesce(p_episode, 1), 1);
$$;

-- Supabase naye functions par anon/authenticated ko by default EXECUTE de deta
-- hai, isliye write-functions se anon ko explicitly revoke karna padta hai.
-- (Warna guest HTTP se cr_add_comment bula sakta tha — function andar se
-- SIGN_IN_REQUIRED phenkta hai, par layer do jagah honi chahiye.)
revoke execute on function public.cr_add_comment(text, integer, integer, text, uuid) from public;
revoke execute on function public.cr_vote_comment(uuid, integer) from public;
revoke execute on function public.cr_comment_author() from public;
revoke execute on function public.cr_add_comment(text, integer, integer, text, uuid) from anon;
revoke execute on function public.cr_vote_comment(uuid, integer) from anon;
revoke execute on function public.cr_comment_author() from anon;

grant execute on function public.cr_add_comment(text, integer, integer, text, uuid) to authenticated;
grant execute on function public.cr_list_comments(text, integer, integer, text) to anon, authenticated;
grant execute on function public.cr_vote_comment(uuid, integer) to authenticated;
grant execute on function public.cr_comment_count(text, integer, integer) to anon, authenticated;
grant execute on function public.cr_comment_author() to authenticated;

notify pgrst, 'reload schema';
