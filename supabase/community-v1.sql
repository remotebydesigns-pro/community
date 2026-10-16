-- Remote by Designs Community v1
-- Adds the community (feed, comments, likes, messages, events, notifications) to the
-- RBD Academy database. Members sign in with their Academy account.
-- Only adds new cm_* tables, functions and the "community" storage bucket. Existing tables are untouched.
-- Safe to run more than once.

-- ---------- Members ----------
create table if not exists public.cm_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  headline     text check (char_length(headline) <= 120),
  bio          text check (char_length(bio) <= 1000),
  location     text check (char_length(location) <= 80),
  avatar_url   text check (char_length(avatar_url) <= 500),
  banned       boolean not null default false,
  joined_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Signed-in, not banned member?
create or replace function public.cm_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cm_members where user_id = auth.uid() and not banned);
$$;

-- Join (or re-join) using the Academy profile name
create or replace function public.cm_join()
returns json language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'Please sign in first.'); end if;
  select coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1)) into v_name from public.profiles where id = auth.uid();
  insert into public.cm_members (user_id, display_name) values (auth.uid(), left(coalesce(v_name, 'Member'), 80))
  on conflict (user_id) do nothing;
  if exists (select 1 from public.cm_members where user_id = auth.uid() and banned) then
    return json_build_object('ok', false, 'error', 'Your community access has been paused. Contact support@remotebydesigns.com.');
  end if;
  return json_build_object('ok', true);
end $$;

-- Members can't unban themselves; only admins change "banned"
create or replace function public.cm_members_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.banned is distinct from old.banned and not public.is_admin() then new.banned := old.banned; end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger cm_members_guard before update on public.cm_members for each row execute function public.cm_members_guard();

-- ---------- Categories ----------
create table if not exists public.cm_categories (
  id         text primary key,
  name       text not null,
  sort       int  not null default 0,
  admin_only boolean not null default false
);
insert into public.cm_categories (id, name, sort, admin_only) values
  ('general',      'General Discussion',  1, false),
  ('introductions','Introductions',       2, false),
  ('career',       'Career Questions',    3, false),
  ('remote-tips',  'Remote Work Tips',    4, false),
  ('wins',         'Wins & Milestones',   5, false),
  ('tools',        'Tools & Resources',   6, false),
  ('announcement', 'Announcement',        0, true)
on conflict (id) do nothing;

-- ---------- Posts ----------
create table if not exists public.cm_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.cm_members(user_id) on delete cascade,
  category_id text not null default 'general' references public.cm_categories(id),
  body        text not null check (char_length(body) between 1 and 5000),
  image_url   text check (char_length(image_url) <= 500),
  link_url    text check (char_length(link_url) <= 500),
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cm_posts_feed on public.cm_posts (pinned desc, created_at desc);

-- Only admins can pin or post in admin-only categories
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
  if tg_op = 'UPDATE' then new.updated_at := now(); new.author_id := old.author_id; new.created_at := old.created_at; end if;
  return new;
end $$;
create or replace trigger cm_posts_guard before insert or update on public.cm_posts for each row execute function public.cm_posts_guard();

-- ---------- Comments & likes ----------
create table if not exists public.cm_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.cm_posts(id) on delete cascade,
  author_id  uuid not null references public.cm_members(user_id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists cm_comments_post on public.cm_comments (post_id, created_at);

create table if not exists public.cm_likes (
  post_id    uuid not null references public.cm_posts(id) on delete cascade,
  user_id    uuid not null references public.cm_members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------- Events ----------
create table if not exists public.cm_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 160),
  description text check (char_length(description) <= 4000),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  location    text check (char_length(location) <= 300),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists cm_events_start on public.cm_events (starts_at);

create table if not exists public.cm_rsvps (
  event_id   uuid not null references public.cm_events(id) on delete cascade,
  user_id    uuid not null references public.cm_members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ---------- Direct messages ----------
create table if not exists public.cm_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.cm_members(user_id) on delete cascade,
  recipient_id uuid not null references public.cm_members(user_id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 3000),
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists cm_messages_pair on public.cm_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at);
create index if not exists cm_messages_recipient on public.cm_messages (recipient_id, read_at);

-- Recipients may only mark messages read; nothing else changes
create or replace function public.cm_messages_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id := old.id; new.sender_id := old.sender_id; new.recipient_id := old.recipient_id;
  new.body := old.body; new.created_at := old.created_at;
  return new;
end $$;
create or replace trigger cm_messages_guard before update on public.cm_messages for each row execute function public.cm_messages_guard();

-- ---------- Notifications ----------
create table if not exists public.cm_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.cm_members(user_id) on delete cascade,
  actor_id   uuid references public.cm_members(user_id) on delete cascade,
  kind       text not null check (kind in ('comment','like','message','announcement','event')),
  post_id    uuid references public.cm_posts(id) on delete cascade,
  event_id   uuid references public.cm_events(id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cm_notifications_user on public.cm_notifications (user_id, created_at desc);

create or replace function public.cm_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if tg_table_name = 'cm_comments' then
    select author_id into v_owner from public.cm_posts where id = new.post_id;
    if v_owner is not null and v_owner <> new.author_id then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id) values (v_owner, new.author_id, 'comment', new.post_id);
    end if;
  elsif tg_table_name = 'cm_likes' then
    select author_id into v_owner from public.cm_posts where id = new.post_id;
    if v_owner is not null and v_owner <> new.user_id then
      insert into public.cm_notifications (user_id, actor_id, kind, post_id) values (v_owner, new.user_id, 'like', new.post_id);
    end if;
  elsif tg_table_name = 'cm_messages' then
    insert into public.cm_notifications (user_id, actor_id, kind) values (new.recipient_id, new.sender_id, 'message');
  elsif tg_table_name = 'cm_posts' and new.category_id = 'announcement' then
    insert into public.cm_notifications (user_id, actor_id, kind, post_id)
      select user_id, new.author_id, 'announcement', new.id from public.cm_members where not banned and user_id <> new.author_id;
  elsif tg_table_name = 'cm_events' then
    insert into public.cm_notifications (user_id, kind, event_id)
      select user_id, 'event', new.id from public.cm_members where not banned and user_id is distinct from new.created_by;
  end if;
  return new;
end $$;
create or replace trigger cm_notify after insert on public.cm_comments for each row execute function public.cm_notify();
create or replace trigger cm_notify after insert on public.cm_likes for each row execute function public.cm_notify();
create or replace trigger cm_notify after insert on public.cm_messages for each row execute function public.cm_notify();
create or replace trigger cm_notify after insert on public.cm_posts for each row execute function public.cm_notify();
create or replace trigger cm_notify after insert on public.cm_events for each row execute function public.cm_notify();

-- ---------- Admin stats ----------
create or replace function public.cm_admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'members',       (select count(*) from cm_members where not banned),
    'new_members_7d',(select count(*) from cm_members where joined_at > now() - interval '7 days'),
    'posts',         (select count(*) from cm_posts),
    'posts_7d',      (select count(*) from cm_posts where created_at > now() - interval '7 days'),
    'comments',      (select count(*) from cm_comments),
    'upcoming_events',(select count(*) from cm_events where starts_at > now()),
    'banned',        (select count(*) from cm_members where banned));
end $$;

-- ---------- Row level security ----------
alter table public.cm_members       enable row level security;
alter table public.cm_categories    enable row level security;
alter table public.cm_posts         enable row level security;
alter table public.cm_comments      enable row level security;
alter table public.cm_likes         enable row level security;
alter table public.cm_events        enable row level security;
alter table public.cm_rsvps         enable row level security;
alter table public.cm_messages      enable row level security;
alter table public.cm_notifications enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename like 'cm\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Members
create policy "members read members" on public.cm_members for select to authenticated using (public.cm_is_member() or user_id = auth.uid() or public.is_admin());
create policy "edit own member card" on public.cm_members for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());
-- Categories
create policy "read categories" on public.cm_categories for select to authenticated using (true);
-- Posts
create policy "members read posts" on public.cm_posts for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "members create posts" on public.cm_posts for insert to authenticated with check (author_id = auth.uid() and public.cm_is_member());
create policy "edit own posts" on public.cm_posts for update to authenticated using ((author_id = auth.uid() and public.cm_is_member()) or public.is_admin()) with check ((author_id = auth.uid() and public.cm_is_member()) or public.is_admin());
create policy "delete own posts" on public.cm_posts for delete to authenticated using (author_id = auth.uid() or public.is_admin());
-- Comments
create policy "members read comments" on public.cm_comments for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "members comment" on public.cm_comments for insert to authenticated with check (author_id = auth.uid() and public.cm_is_member());
create policy "delete own comments" on public.cm_comments for delete to authenticated using (author_id = auth.uid() or public.is_admin());
-- Likes
create policy "members read likes" on public.cm_likes for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "members like" on public.cm_likes for insert to authenticated with check (user_id = auth.uid() and public.cm_is_member());
create policy "members unlike" on public.cm_likes for delete to authenticated using (user_id = auth.uid());
-- Events
create policy "members read events" on public.cm_events for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "admins manage events" on public.cm_events for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- RSVPs
create policy "members read rsvps" on public.cm_rsvps for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "members rsvp" on public.cm_rsvps for insert to authenticated with check (user_id = auth.uid() and public.cm_is_member());
create policy "members cancel rsvp" on public.cm_rsvps for delete to authenticated using (user_id = auth.uid());
-- Messages: only the two people in the conversation
create policy "read own messages" on public.cm_messages for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy "send messages" on public.cm_messages for insert to authenticated with check (
  sender_id = auth.uid() and public.cm_is_member()
  and exists (select 1 from public.cm_members m where m.user_id = cm_messages.recipient_id and not m.banned));
create policy "mark messages read" on public.cm_messages for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
-- Notifications
create policy "read own notifications" on public.cm_notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications" on public.cm_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Grants (signed-in users only; nothing for anonymous visitors) ----------
-- Supabase grants everything to anon/authenticated by default; reset, then grant only what's needed.
revoke all on public.cm_members, public.cm_categories, public.cm_posts, public.cm_comments, public.cm_likes,
  public.cm_events, public.cm_rsvps, public.cm_messages, public.cm_notifications from anon, authenticated;
grant select on public.cm_members, public.cm_categories, public.cm_posts, public.cm_comments, public.cm_likes,
  public.cm_events, public.cm_rsvps, public.cm_messages, public.cm_notifications to authenticated;
grant update (display_name, headline, bio, location, avatar_url, banned) on public.cm_members to authenticated;
grant insert (author_id, category_id, body, image_url, link_url, pinned) on public.cm_posts to authenticated;
grant update (category_id, body, image_url, link_url, pinned) on public.cm_posts to authenticated;
grant delete on public.cm_posts to authenticated;
grant insert (post_id, author_id, body) on public.cm_comments to authenticated;
grant delete on public.cm_comments to authenticated;
grant insert (post_id, user_id), delete on public.cm_likes to authenticated;
grant insert, update, delete on public.cm_events to authenticated;
grant insert (event_id, user_id), delete on public.cm_rsvps to authenticated;
grant insert (sender_id, recipient_id, body) on public.cm_messages to authenticated;
grant update (read_at) on public.cm_messages to authenticated;
grant update (read_at) on public.cm_notifications to authenticated;

revoke all on function public.cm_is_member(), public.cm_join(), public.cm_admin_stats() from public, anon;
grant execute on function public.cm_is_member(), public.cm_join(), public.cm_admin_stats() to authenticated;
revoke all on function public.cm_members_guard(), public.cm_posts_guard(), public.cm_notify(), public.cm_messages_guard() from public, anon, authenticated;

-- ---------- Live updates (new posts, messages, notifications) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.cm_posts; exception when others then null; end;
  begin alter publication supabase_realtime add table public.cm_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.cm_notifications; exception when others then null; end;
end $$;

-- ---------- Image uploads: bucket "community", each member writes only to their own folder ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "cm upload own folder" on storage.objects;
create policy "cm upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text and public.cm_is_member());
drop policy if exists "cm delete own files" on storage.objects;
create policy "cm delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- Who are the admins (ids only; used for the ADMIN badge) ----------
create or replace function public.cm_admin_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.profiles p where p.is_admin and public.cm_is_member();
$$;
revoke all on function public.cm_admin_ids() from public, anon;
grant execute on function public.cm_admin_ids() to authenticated;
