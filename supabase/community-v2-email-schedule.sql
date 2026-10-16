-- Remote by Designs Community v2: email schedule (already applied Oct 16, 2026; kept as the record).
-- Needs the "community-email" Edge Function deployed (verify_jwt off).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Shared key between the scheduler and the function (generated inside the database, never copied out)
select vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'cm_email_cron_key', 'Key the community-email function expects from the scheduler')
where not exists (select 1 from vault.secrets where name = 'cm_email_cron_key');

create or replace function public.cm_email_cron_key()
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cm_email_cron_key' limit 1;
$$;
revoke all on function public.cm_email_cron_key() from public, anon, authenticated;
grant execute on function public.cm_email_cron_key() to service_role;

-- Every 10 minutes: email unread notifications
select cron.schedule('community-email-queue', '*/10 * * * *', $$select net.http_post(
  url := 'https://heamxeoqtncuneeoreda.supabase.co/functions/v1/community-email',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='cm_email_cron_key')),
  body := '{"mode":"queue"}'::jsonb, timeout_milliseconds := 60000)$$);

-- Mondays 01:00 UTC (9:00 AM Manila): weekly round-up
select cron.schedule('community-email-digest', '0 1 * * 1', $$select net.http_post(
  url := 'https://heamxeoqtncuneeoreda.supabase.co/functions/v1/community-email',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-key',(select decrypted_secret from vault.decrypted_secrets where name='cm_email_cron_key')),
  body := '{"mode":"digest"}'::jsonb, timeout_milliseconds := 120000)$$);
