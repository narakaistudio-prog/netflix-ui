-- Crunchyroll player ke Like / Dislike (Task 14).
--
-- Owner: “like bhi save hona chahiye”. Pehle ye sirf page ke memory variable me
-- tha (reload par gayab). Ab har reaction Supabase me user + episode ke saath
-- save hota hai, aur counts sabko dikhte hain.
--
-- Kaun likh sakta hai: sirf signed-in user (guest ko sign-in modal dikhta hai).
-- Wahi button dobara dabane par reaction hat jata hai (toggle).
--
-- Deploy: Supabase project `wavzzkbemvujvgdaczqq` (region ap-south-1).

create table if not exists public.cr_episode_reactions (
  show_key text not null,
  season integer not null default 1,
  episode integer not null default 1,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (show_key, season, episode, user_id)
);

alter table public.cr_episode_reactions enable row level security;

-- Counts sab dekh sakein (guest bhi), isliye read open.
drop policy if exists cr_reactions_read on public.cr_episode_reactions;
create policy cr_reactions_read on public.cr_episode_reactions for select using (true);

-- Direct write band — insert/update/delete sirf niche wale RPC se.
grant select on public.cr_episode_reactions to anon, authenticated;

create or replace function public.cr_reaction_counts(
  p_show_key text,
  p_season integer,
  p_episode integer
) returns table (like_count integer, dislike_count integer, my_vote integer)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int,
    coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int,
    coalesce(max(case when r.user_id = auth.uid() then r.value end), 0)::int
  from public.cr_episode_reactions r
  where r.show_key = coalesce(p_show_key, '')
    and r.season = greatest(coalesce(p_season, 1), 1)
    and r.episode = greatest(coalesce(p_episode, 1), 1);
$$;

create or replace function public.cr_toggle_reaction(
  p_show_key text,
  p_season integer,
  p_episode integer,
  p_value integer
) returns table (like_count integer, dislike_count integer, my_vote integer)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_current integer;
  v_season integer := greatest(coalesce(p_season, 1), 1);
  v_episode integer := greatest(coalesce(p_episode, 1), 1);
  v_key text := coalesce(nullif(btrim(p_show_key), ''), 'unknown');
begin
  if v_uid is null then
    raise exception 'SIGN_IN_REQUIRED' using errcode = '28000';
  end if;
  if p_value not in (-1, 1) then
    raise exception 'BAD_REACTION';
  end if;

  select value into v_current
  from public.cr_episode_reactions
  where show_key = v_key and season = v_season and episode = v_episode and user_id = v_uid;

  if v_current is null then
    insert into public.cr_episode_reactions (show_key, season, episode, user_id, value)
    values (v_key, v_season, v_episode, v_uid, p_value);
  elsif v_current = p_value then
    delete from public.cr_episode_reactions
    where show_key = v_key and season = v_season and episode = v_episode and user_id = v_uid;
  else
    update public.cr_episode_reactions set value = p_value
    where show_key = v_key and season = v_season and episode = v_episode and user_id = v_uid;
  end if;

  return query
    select
      coalesce(sum(case when r.value = 1 then 1 else 0 end), 0)::int,
      coalesce(sum(case when r.value = -1 then 1 else 0 end), 0)::int,
      coalesce(max(case when r.user_id = v_uid then r.value end), 0)::int
    from public.cr_episode_reactions r
    where r.show_key = v_key and r.season = v_season and r.episode = v_episode;
end;
$$;

-- Supabase naye functions par anon ko bhi EXECUTE de deta hai; write wale se
-- wapas le lo (read/counts guest ke liye chhod do).
revoke execute on function public.cr_toggle_reaction(text, integer, integer, integer) from public;
revoke execute on function public.cr_toggle_reaction(text, integer, integer, integer) from anon;

grant execute on function public.cr_toggle_reaction(text, integer, integer, integer) to authenticated;
grant execute on function public.cr_reaction_counts(text, integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';
