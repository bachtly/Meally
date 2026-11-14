-- Idempotent: safe to apply on every deploy. Secrets come from Vault, never from this file.
-- The deploy script stores `meally_project_url` (https://<ref>.supabase.co) and `meally_jobs_secret` first.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname like 'meally-%';

select cron.schedule('meally-webhooks-retry', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'meally_project_url') || '/functions/v1/meally/api/v1/internal/jobs/webhooks.retry',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meally_jobs_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);

select cron.schedule('meally-mealplan-digest', '*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'meally_project_url') || '/functions/v1/meally/api/v1/internal/jobs/mealplan.digest',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meally_jobs_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);

select cron.schedule('meally-shares-cleanup', '17 3 * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'meally_project_url') || '/functions/v1/meally/api/v1/internal/jobs/shares.cleanup',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meally_jobs_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);

-- Finishes the household-to-user image rekey (ADR 0003). A no-op once `image_moves` is empty.
select cron.schedule('meally-images-move', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'meally_project_url') || '/functions/v1/meally/api/v1/internal/jobs/images.move',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meally_jobs_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);

-- Sends queued Web Push notifications for new Snaps and Reactions (F8). The edge has no timers, so this is the sender.
select cron.schedule('meally-push-deliver', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'meally_project_url') || '/functions/v1/meally/api/v1/internal/jobs/push.deliver',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'meally_jobs_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$job$);
