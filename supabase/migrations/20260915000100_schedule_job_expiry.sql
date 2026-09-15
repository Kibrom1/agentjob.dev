-- =============================================================================
-- Schedule public.expire_jobs() every 15 minutes via pg_cron.
--
-- Visibility never depends on this job (RLS and search_jobs both filter on
-- expires_at > now()); the sweep keeps `status` and `is_featured` truthful for
-- admin views and billing reports. Skipped cleanly where pg_cron is not
-- installed (e.g. plain Postgres in CI).
-- =============================================================================
do $migration$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; skipping expire_jobs schedule';
    return;
  end if;

  create extension if not exists pg_cron with schema pg_catalog;

  if exists (select 1 from cron.job where jobname = 'expire-jobs') then
    perform cron.unschedule('expire-jobs');
  end if;

  perform cron.schedule('expire-jobs', '*/15 * * * *', 'select public.expire_jobs()');
end;
$migration$;
