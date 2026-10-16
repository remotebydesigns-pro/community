-- Remote by Designs Community v2
-- Email notifications (preferences, queue tracking, weekly digest runs), first-run onboarding,
-- post editing, reports, and "also commented" notifications.
-- Run after community-v1.sql. Safe to run more than once. Only touches cm_* objects.

-- ---------- Onboarding ----------
alter table public.cm_members add column if not exists onboarded_at timestamptz;
grant update (onboarded_at) on public.cm_members to authenticated;

-- ---------- Post editing ----------
alter table public.cm_posts add column if not exists edited_at timestamptz;

create or replace function public.cm_posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if tg_op = 'INSERT' then new.pinned := false;
    elsif new.pinned is distinct from old.pinned then new.pinned := old.pinned; end if;
    if exists (select 1 from public.cm_categories where id = new.category_id and admin_only) then
      raise exception 'Only the RBD team can post in this category.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now(); new.author_id := old.author_id; new.created_at := old.created_at;
    if new.body is distinct from old.body or new.link_url is distinct from old.link_url
       or new.image_url is distinct from old.image_url or new.category_id is distinct from old.category_id then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
  else
    new.edited_at := null;
  end if;
  return new;
end $$;

-- ---------- Email preferences (one row per member, only they can see or change it) ----------
create table if not exists public.cm_email_prefs (
  user_id       uuid primary key references public.cm_members(user_id) on delete cascade,
  announcements boolean not null default true,
  events        boolean not null default true,
  messages      boolean not null default true,
  activity      boolean not null default true,   -- comments on your posts and posts you commented on
  digest        boolean not null default true,   -- weekly round-up
  token         uuid not null default gen_random_uuid() unique,  -- for one-click unsubscribe links
  updated_at    timestamptz not null default now()
);
insert into public.cm_email_prefs (user_id) select user_id from public.cm_members on conflict do nothing;

alter table public.cm_email_prefs enable row level security;
drop policy if exists "read own email prefs" on public.cm_email_prefs;
create policy "read own email prefs" on public.cm_email_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists "edit own email prefs" on public.cm_email_prefs;
create policy "edit own email prefs" on public.cm_email_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.cm_email_prefs from anon, authenticated;
grant select (user_id, announcements, events, messages, activity, digest, updated_at) on public.cm_email_prefs to authenticated;
grant update (announcements, events, messages, activity, digest) on public.cm_email_prefs to authenticated;

create or replace function public.cm_email_prefs_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.token := old.token; new.user_id := old.user_id; return new; end $$;
drop trigger if exists cm_email_prefs_touch on public.cm_email_prefs;
create trigger cm_email_prefs_touch before update on public.cm_email_prefs for each row execute function public.cm_email_prefs_touch();

-- Track which notifications were already emailed
alter table public.cm_notifications add column if not exists emailed_at timestamptz;
create index if not exists cm_notifications_email_queue on public.cm_notifications (created_at) where emailed_at is null;

-- Weekly digest bookkeeping (server only; no policies = no member access)
create table if not exists public.cm_email_runs (
  id         text primary key,
  sent       int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.cm_email_runs enable row level security;
revoke all on public.cm_email_runs from anon, authenticated;

-- ---------- Join: never show part of an email address as a name ----------
create or replace function public.cm_join()
returns json language plpgsql security definer set search_path = public as $$
declare v_name text; v_headline text; v_bio text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'Please sign in first.'); end if;
  -- Start the member card from the Academy profile (name, headline, bio) so it isn't blank
  select nullif(trim(full_name), ''), nullif(trim(headline), ''), nullif(trim(bio), '')
    into v_name, v_headline, v_bio from public.profiles where id = auth.uid();
  insert into public.cm_members (user_id, display_name, headline, bio)
  values (auth.uid(), left(coalesce(v_name, 'Member'), 80), left(v_headline, 120), left(v_bio, 1000))
  on conflict (user_id) do nothing;
  insert into public.cm_email_prefs (user_id) values (auth.uid()) on conflict do nothing;
  if exists (select 1 from public.cm_members where user_id = auth.uid() and banned) then
    return json_build_object('ok', false, 'error', 'Your community access has been paused. Contact support@remotebydesigns.com.');
  end if;
  return json_build_object('ok', true);
end $$;

-- Clean up any member names that were filled in from an email address
update public.cm_members m set display_name = 'Member'
from public.profiles p
where p.id = m.user_id and coalesce(trim(p.full_name), '') = ''
  and p.email is not null and m.display_name = split_part(p.email, '@', 1);

-- ---------- Reports ----------
create table if not exists public.cm_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid references public.cm_posts(id) on delete cascade,
  comment_id  uuid references public.cm_comments(id) on delete cascade,
  reporter_id uuid not null references public.cm_members(user_id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  check (post_id is not null or comment_id is not null)
);
create unique index if not exists cm_reports_once on public.cm_reports (reporter_id, post_id, comment_id) nulls not distinct;
create index if not exists cm_reports_open on public.cm_reports (status, created_at desc);

create or replace function public.cm_reports_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.post_id := old.post_id; new.comment_id := old.comment_id; new.reporter_id := old.reporter_id;
    new.reason := old.reason; new.created_at := old.created_at;
    if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now(); new.resolved_by := auth.uid();
    elsif new.status = 'open' then new.resolved_at := null; new.resolved_by := null; end if;
  else
    new.status := 'open'; new.resolved_at := null; new.resolved_by := null;
  end if;
  return new;
end $$;
drop trigger if exists cm_reports_guard on public.cm_reports;
create trigger cm_reports_guard before insert or update on public.cm_reports for each row execute function public.cm_reports_guard();

alter table public.cm_reports enable row level security;
drop policy if exists "members report" on public.cm_reports;
create policy "members report" on public.cm_reports for insert to authenticated with check (reporter_id = auth.uid() and public.cm_is_member());
drop policy if exists "read reports" on public.cm_reports;
create policy "read reports" on public.cm_reports for select to authenticated using (public.is_admin() or reporter_id = auth.uid());
drop policy if exists "admins resolve reports" on public.cm_reports;
create policy "admins resolve reports" on public.cm_reports for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.cm_reports from anon, authenticated;
grant select on public.cm_reports to authenticated;
grant insert (post_id, comment_id, reporter_id, reason) on public.cm_reports to authenticated;
grant update (status) on public.cm_reports to authenticated;

-- ---------- Notifications: new kinds "reply" (also commented) and "report" (admins) ----------
alter table public.cm_notifications drop constraint if exists cm_notifications_kind_check;
alter table public.cm_notifications add constraint cm_notifications_kind_check
  check (kind in ('comment','reply','like','message','announcement','event','report'));

create or replace function public.cm_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if tg_table_name = 'cm_comments' then
    select author_id into v_owner from public.cm_posts where id = new.post_id;
    if v_owner is not null and v_owner <> new.author_id then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id) values (v_owner, new.author_id, 'comment', new.post_id);
    end if;
    -- Everyone else who commented on this post hears about the new comment
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
    -- nested check: other tables' rows have no category_id, so it can't sit in the same condition
    if new.category_id = 'announcement' then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id)
        select user_id, new.author_id, 'announcement', new.id from public.cm_members where not banned and user_id <> new.author_id;
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
drop trigger if exists cm_notify on public.cm_reports;
create trigger cm_notify after insert on public.cm_reports for each row execute function public.cm_notify();
revoke all on function public.cm_notify(), public.cm_posts_guard(), public.cm_reports_guard(), public.cm_email_prefs_touch() from public, anon, authenticated;

-- ---------- Admin stats: add open reports ----------
create or replace function public.cm_admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'members',        (select count(*) from cm_members where not banned),
    'new_members_7d', (select count(*) from cm_members where joined_at > now() - interval '7 days'),
    'posts',          (select count(*) from cm_posts),
    'posts_7d',       (select count(*) from cm_posts where created_at > now() - interval '7 days'),
    'comments',       (select count(*) from cm_comments),
    'upcoming_events',(select count(*) from cm_events where starts_at > now()),
    'banned',         (select count(*) from cm_members where banned),
    'active_7d',      (select count(distinct a) from (
                         select author_id a from cm_posts where created_at > now() - interval '7 days'
                         union all select author_id from cm_comments where created_at > now() - interval '7 days'
                         union all select user_id from cm_likes where created_at > now() - interval '7 days'
                         union all select user_id from cm_rsvps where created_at > now() - interval '7 days') x),
    'open_reports',   (select count(*) from cm_reports where status = 'open'),
    'academy_not_joined', (select count(*) from profiles p where not exists (select 1 from cm_members m where m.user_id = p.id)));
end $$;
