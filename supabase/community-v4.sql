-- Remote by Designs Community v4 (Oct 16, 2026)
-- "I applied" on job posts (count for everyone, names for admins) and badges admins can award.
-- Run after community-v3.sql. Safe to run more than once.

-- ---------- Job applications ("I applied") ----------
create table if not exists public.cm_job_applies (
  post_id    uuid not null references public.cm_posts(id) on delete cascade,
  user_id    uuid not null references public.cm_members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create or replace function public.cm_is_open_job(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cm_posts where id = pid and category_id = 'jobs' and not job_closed);
$$;
alter table public.cm_job_applies enable row level security;
create policy "mark applied" on public.cm_job_applies for insert to authenticated
  with check (user_id = auth.uid() and public.cm_is_member() and public.cm_is_open_job(post_id));
create policy "unmark applied" on public.cm_job_applies for delete to authenticated using (user_id = auth.uid());
create policy "see own or admin" on public.cm_job_applies for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke all on public.cm_job_applies from anon, authenticated;
grant select, delete on public.cm_job_applies to authenticated;
grant insert (post_id, user_id) on public.cm_job_applies to authenticated;

-- Counts for everyone (who applied stays private to admins)
create or replace function public.cm_job_applied(pids uuid[])
returns table (post_id uuid, applied int, mine boolean) language sql stable security definer set search_path = public as $$
  select p.id, count(a.user_id)::int, coalesce(bool_or(a.user_id = auth.uid()), false)
  from unnest(pids) as p(id) left join public.cm_job_applies a on a.post_id = p.id
  where public.cm_is_member() or public.is_admin()
  group by p.id;
$$;

-- ---------- Badges admins award ----------
create table if not exists public.cm_member_badges (
  user_id    uuid not null references public.cm_members(user_id) on delete cascade,
  badge      text not null check (badge in ('graduate','certified','mentor','rising','hired','host','spotlight','helper-award')),
  note       text check (char_length(note) <= 140),
  awarded_by uuid references auth.users(id) on delete set null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge)
);
alter table public.cm_member_badges enable row level security;
create policy "members see awarded badges" on public.cm_member_badges for select to authenticated using (public.cm_is_member() or public.is_admin());
create policy "admins award badges" on public.cm_member_badges for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.cm_member_badges from anon, authenticated;
grant select, insert, update, delete on public.cm_member_badges to authenticated;

-- Bell notification when someone gets a badge
alter table public.cm_notifications add column if not exists badge text;
alter table public.cm_notifications drop constraint if exists cm_notifications_kind_check;
alter table public.cm_notifications add constraint cm_notifications_kind_check
  check (kind in ('comment','reply','like','message','announcement','event','report','group','birthday','job','badge'));
create or replace function public.cm_badge_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.awarded_by := auth.uid();
  insert into public.cm_notifications (user_id, actor_id, kind, badge, emailed_at)
  values (new.user_id, (select user_id from public.cm_members where user_id = auth.uid()), 'badge', new.badge, now());
  return new;
end $$;
create or replace trigger cm_badge_notify before insert on public.cm_member_badges for each row execute function public.cm_badge_notify();

revoke all on function public.cm_badge_notify() from public, anon, authenticated;
revoke all on function public.cm_is_open_job(uuid), public.cm_job_applied(uuid[]) from public, anon;
grant execute on function public.cm_is_open_job(uuid), public.cm_job_applied(uuid[]) to authenticated;
