-- Remote by Designs Community v3 (Oct 16, 2026)
-- Job Board, private groups (Bootcamp), link-only images/videos, badges, birthdays, livelier admin stats.
-- Run after community-v2.sql. Safe to run more than once.

-- ---------- Categories: Job Board in, Career Questions + Remote Work Tips out (folded into General) ----------
alter table public.cm_categories add column if not exists hidden boolean not null default false;
insert into public.cm_categories (id, name, sort, admin_only) values ('jobs', 'Job Board', 2, true)
on conflict (id) do update set name = excluded.name, admin_only = true, hidden = false;
-- Hidden rather than deleted, so nothing that ever pointed at them breaks. The app doesn't show hidden ones.
insert into public.cm_categories (id, name, sort, admin_only, hidden) values ('career','Career Questions',3,false,true), ('remote-tips','Remote Work Tips',4,false,true)
on conflict (id) do update set hidden = true;

-- ---------- Groups (private spaces such as the Bootcamp) ----------
create table if not exists public.cm_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  created_at  timestamptz not null default now()
);
create table if not exists public.cm_group_members (
  group_id uuid not null references public.cm_groups(id) on delete cascade,
  user_id  uuid not null references public.cm_members(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
insert into public.cm_groups (slug, name, description)
values ('bootcamp', 'Bootcamp', 'A private space for Bootcamp participants: questions, lessons, homework help and wins.')
on conflict (slug) do nothing;

create or replace function public.cm_in_group(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.cm_group_members g join public.cm_members m on m.user_id = g.user_id and not m.banned
    where g.group_id = gid and g.user_id = auth.uid());
$$;
create or replace function public.cm_can_see_post(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cm_posts p where p.id = pid and (p.group_id is null or public.cm_in_group(p.group_id)));
$$;

alter table public.cm_groups enable row level security;
alter table public.cm_group_members enable row level security;
drop policy if exists "see my groups" on public.cm_groups;
create policy "see my groups" on public.cm_groups for select to authenticated using (public.cm_in_group(id));
drop policy if exists "admins manage groups" on public.cm_groups;
create policy "admins manage groups" on public.cm_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "see group members" on public.cm_group_members;
create policy "see group members" on public.cm_group_members for select to authenticated using (public.cm_in_group(group_id));
drop policy if exists "admins manage group members" on public.cm_group_members;
create policy "admins manage group members" on public.cm_group_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.cm_groups, public.cm_group_members from anon, authenticated;
grant select, insert, update, delete on public.cm_groups, public.cm_group_members to authenticated;

-- ---------- Posts: group, video link, job details ----------
alter table public.cm_posts add column if not exists group_id   uuid references public.cm_groups(id) on delete cascade;
alter table public.cm_posts add column if not exists video_url  text check (char_length(video_url) <= 500);
alter table public.cm_posts add column if not exists job        jsonb;
alter table public.cm_posts add column if not exists job_closed boolean not null default false;
create index if not exists cm_posts_group on public.cm_posts (group_id, created_at desc);
grant insert (group_id, video_url, job) on public.cm_posts to authenticated;
grant update (video_url, job, job_closed) on public.cm_posts to authenticated;

-- Only posts members are allowed to see: public posts, or posts in a group they belong to
alter policy "members read posts" on public.cm_posts
  using ((public.cm_is_member() and (group_id is null or public.cm_in_group(group_id))) or public.is_admin());
alter policy "members create posts" on public.cm_posts
  with check (author_id = auth.uid() and public.cm_is_member() and (group_id is null or public.cm_in_group(group_id)));
alter policy "members read comments" on public.cm_comments
  using ((public.cm_is_member() and public.cm_can_see_post(post_id)) or public.is_admin());
alter policy "members comment" on public.cm_comments
  with check (author_id = auth.uid() and public.cm_is_member() and public.cm_can_see_post(post_id));
alter policy "members read likes" on public.cm_likes
  using ((public.cm_is_member() and public.cm_can_see_post(post_id)) or public.is_admin());
alter policy "members like" on public.cm_likes
  with check (user_id = auth.uid() and public.cm_is_member() and public.cm_can_see_post(post_id));

create or replace function public.cm_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then new.pinned := false; new.job_closed := false;
    else
      if new.pinned is distinct from old.pinned then new.pinned := old.pinned; end if;
      new.job_closed := old.job_closed;
    end if;
    if exists (select 1 from public.cm_categories where id = new.category_id and admin_only) then
      raise exception 'Only the RBD team can post in this category.';
    end if;
    if exists (select 1 from public.cm_categories where id = new.category_id and hidden) then
      if tg_op = 'INSERT' then raise exception 'That topic was retired. Please pick another one.'; end if;
      if new.category_id is distinct from old.category_id then raise exception 'That topic was retired. Please pick another one.'; end if;
    end if;
    if new.job is not null and new.category_id <> 'jobs' then new.job := null; end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now(); new.author_id := old.author_id; new.created_at := old.created_at; new.group_id := old.group_id;
    if new.body is distinct from old.body or new.link_url is distinct from old.link_url or new.video_url is distinct from old.video_url
       or new.image_url is distinct from old.image_url or new.category_id is distinct from old.category_id or new.job is distinct from old.job then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
  else
    new.edited_at := null;
  end if;
  return new;
end $$;

-- ---------- Birthdays (private table; others only see it if the member allows) ----------
create table if not exists public.cm_birthdays (
  user_id    uuid primary key references public.cm_members(user_id) on delete cascade,
  month      smallint not null check (month between 1 and 12),
  day        smallint not null check (day between 1 and 31),
  show       boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((month in (4,6,9,11) and day <= 30) or (month = 2 and day <= 29) or month in (1,3,5,7,8,10,12))
);
alter table public.cm_birthdays enable row level security;
drop policy if exists "own birthday" on public.cm_birthdays;
create policy "own birthday" on public.cm_birthdays for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.cm_is_member());
revoke all on public.cm_birthdays from anon, authenticated;
grant select, insert, update, delete on public.cm_birthdays to authenticated;

-- Shared birthdays (month/day only) of members who chose to show them
create or replace function public.cm_public_birthdays()
returns table (user_id uuid, month smallint, day smallint) language sql stable security definer set search_path = public as $$
  select b.user_id, b.month, b.day from public.cm_birthdays b
  join public.cm_members m on m.user_id = b.user_id and not m.banned
  where b.show and public.cm_is_member();
$$;

-- ---------- Badges: per-member stats (counts only) ----------
create or replace function public.cm_member_stats()
returns table (user_id uuid, posts int, comments int, likes_received int, rsvps int, has_intro boolean,
               join_rank int, score_30d int, in_bootcamp boolean)
language sql stable security definer set search_path = public as $$
  with m as (select user_id, joined_at from public.cm_members where not banned),
  p as (select author_id, count(*) n, count(*) filter (where created_at > now() - interval '30 days') n30,
               bool_or(category_id = 'introductions') intro from public.cm_posts group by author_id),
  c as (select author_id, count(*) n, count(*) filter (where created_at > now() - interval '30 days') n30 from public.cm_comments group by author_id),
  l as (select po.author_id, count(*) n, count(*) filter (where li.created_at > now() - interval '30 days') n30
        from public.cm_likes li join public.cm_posts po on po.id = li.post_id where li.user_id <> po.author_id group by po.author_id),
  r as (select user_id, count(*) n from public.cm_rsvps group by user_id),
  b as (select g.user_id from public.cm_group_members g join public.cm_groups gr on gr.id = g.group_id and gr.slug = 'bootcamp')
  select m.user_id, coalesce(p.n,0)::int, coalesce(c.n,0)::int, coalesce(l.n,0)::int, coalesce(r.n,0)::int,
         coalesce(p.intro,false), (rank() over (order by m.joined_at))::int,
         (coalesce(p.n30,0)*3 + coalesce(c.n30,0)*2 + coalesce(l.n30,0))::int,
         exists (select 1 from b where b.user_id = m.user_id)
  from m left join p on p.author_id = m.user_id left join c on c.author_id = m.user_id
         left join l on l.author_id = m.user_id left join r on r.user_id = m.user_id
  where public.cm_is_member();
$$;

-- ---------- Admin: 14-day activity for the dashboard chart ----------
create or replace function public.cm_admin_activity()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return (select json_agg(json_build_object('day', d::date, 'posts', ps, 'comments', cs, 'joins', js) order by d)
    from (select d,
      (select count(*) from cm_posts where (created_at at time zone 'Asia/Manila')::date = d::date) ps,
      (select count(*) from cm_comments where (created_at at time zone 'Asia/Manila')::date = d::date) cs,
      (select count(*) from cm_members where (joined_at at time zone 'Asia/Manila')::date = d::date) js
      from generate_series((now() at time zone 'Asia/Manila')::date - 13, (now() at time zone 'Asia/Manila')::date, interval '1 day') d) x);
end $$;

-- ---------- Notifications: group posts and birthdays ----------
alter table public.cm_notifications add column if not exists group_id uuid references public.cm_groups(id) on delete cascade;
alter table public.cm_notifications drop constraint if exists cm_notifications_kind_check;
alter table public.cm_notifications add constraint cm_notifications_kind_check
  check (kind in ('comment','reply','like','message','announcement','event','report','group','birthday','job'));

create or replace function public.cm_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if tg_table_name = 'cm_comments' then
    select author_id into v_owner from public.cm_posts where id = new.post_id;
    if v_owner is not null and v_owner <> new.author_id then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id) values (v_owner, new.author_id, 'comment', new.post_id);
    end if;
    insert into public.cm_notifications (user_id, actor_id, kind, post_id)
      select distinct c.author_id, new.author_id, 'reply', new.post_id
      from public.cm_comments c join public.cm_members m on m.user_id = c.author_id and not m.banned
      where c.post_id = new.post_id and c.id <> new.id
        and c.author_id <> new.author_id and c.author_id is distinct from v_owner;
  elsif tg_table_name = 'cm_likes' then
    select author_id into v_owner from public.cm_posts where id = new.post_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id) values (v_owner, new.user_id, 'like', new.post_id);
    end if;
  elsif tg_table_name = 'cm_messages' then
    insert into public.cm_notifications (user_id, actor_id, kind) values (new.recipient_id, new.sender_id, 'message');
  elsif tg_table_name = 'cm_posts' then
    if new.group_id is not null then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id, group_id)
        select g.user_id, new.author_id, 'group', new.id, new.group_id from public.cm_group_members g
        join public.cm_members m on m.user_id = g.user_id and not m.banned
        where g.group_id = new.group_id and g.user_id <> new.author_id;
    elsif new.category_id = 'announcement' then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id)
        select user_id, new.author_id, 'announcement', new.id from public.cm_members where not banned and user_id <> new.author_id;
    elsif new.category_id = 'jobs' then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id)
        select user_id, new.author_id, 'job', new.id from public.cm_members where not banned and user_id <> new.author_id;
    end if;
  elsif tg_table_name = 'cm_events' then
    insert into public.cm_notifications (user_id, kind, event_id)
      select user_id, 'event', new.id from public.cm_members where not banned and user_id is distinct from new.created_by;
  elsif tg_table_name = 'cm_reports' then
    insert into public.cm_notifications (user_id, actor_id, kind, post_id)
      select m.user_id, new.reporter_id, 'report',
             coalesce(new.post_id, (select post_id from public.cm_comments where id = new.comment_id))
      from public.cm_members m join public.profiles p on p.id = m.user_id and p.is_admin
      where m.user_id <> new.reporter_id;
  end if;
  return new;
end $$;

-- Email settings: one more switch for job alerts
alter table public.cm_email_prefs add column if not exists jobs boolean not null default true;
grant select (jobs) on public.cm_email_prefs to authenticated;
grant update (jobs) on public.cm_email_prefs to authenticated;

revoke all on function public.cm_notify(), public.cm_posts_guard() from public, anon, authenticated;
revoke all on function public.cm_in_group(uuid), public.cm_can_see_post(uuid), public.cm_public_birthdays(),
  public.cm_member_stats(), public.cm_admin_activity() from public, anon;
grant execute on function public.cm_in_group(uuid), public.cm_can_see_post(uuid), public.cm_public_birthdays(),
  public.cm_member_stats(), public.cm_admin_activity() to authenticated;

-- Live updates for group feeds use the same cm_posts channel (RLS still applies)

-- ---------- Daily birthday run: 00:00 UTC = 8:00 AM Manila ----------
select cron.schedule('community-email-birthdays', '0 0 * * *', $$select net.http_post(
  url := 'https://heamxeoqtncuneeoreda.supabase.co/functions/v1/community-email',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='cm_email_cron_key')),
  body := '{"mode":"birthdays"}'::jsonb, timeout_milliseconds := 60000)$$);
