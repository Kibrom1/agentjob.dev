# Backup, rollback and restore runbook

Two independent things can go wrong after a release: bad app code (roll back the deployment) and bad data or a
bad migration (restore the database). They have different tools. Do not mix them up: rolling back the app does
not undo a migration.

## 1. App rollback (Vercel instant rollback)

Use when a deployment is broken but the database is fine.

1. Vercel dashboard, project, **Deployments**.
2. Find the last known-good **Production** deployment, open its menu, choose **Promote to Production** (this is
   Vercel's "instant rollback": it re-points the production domain, no rebuild).
3. Verify: `curl -s https://<prod>/api/health` returns `{"status":"ok",...}`, then run
   `SITE_URL=https://<prod> ./scripts/smoke-test.sh`.
4. Fix forward on a branch. Promoting a newer deployment (or merging to `main`) ends the rollback; until then
   new pushes to `main` build but are not promoted automatically on a hobby/pro project with rollback pinned,
   so check the dashboard banner before assuming a push went live.

Cron jobs (`/api/cron/digest`, `/api/cron/maintenance`) follow the production deployment, so a rollback also
rolls back their code.

### Migration compatibility when rolling back the app

Migrations in this repo are additive and applied before the app (see the launch review). The previous app
version should keep working against the newer schema. Exceptions to check before rolling back across a
release: a migration that dropped or renamed something the old code calls. The close-safety migration
(`20261116000300`) replaces `upsert_ingested_jobs` with a wider signature; old callers sending three named
arguments still resolve.

## 2. Database backups (Supabase)

What you have depends on the Supabase plan. Confirm it in **Project settings, Database, Backups** and write the
answer here once known: `Plan: ____  Daily backups: ____ days  PITR: on/off`.

| Option | What it gives | Notes |
|---|---|---|
| Daily backups | One logical backup per day, restorable from the dashboard | Included on paid plans, retention depends on plan. Worst-case data loss is up to 24 hours |
| Point-in-time recovery (PITR) | Restore to any second inside the retention window | Paid add-on. Needed if losing up to a day of paid-job activations or subscribers is unacceptable |
| Manual dump (any plan) | A file you control | See below. Run before every risky migration |

Manual dump (needs the direct or pooler connection string from the dashboard; never paste it into chat or
commit it):

```bash
# Schema + data, custom format, restorable with pg_restore
pg_dump "$DATABASE_URL" --format=custom --no-owner --file="agenticroles-$(date +%F).dump"
```

Take a dump immediately before applying migrations that delete or rewrite data. `20261116000400` is one:
it adds purge steps to `run_maintenance()` (unsubscribed subscribers after 90 days, digest deliveries after
12 months, employer jobs and employers after 24 months). The purge only runs from the daily cron, so a dump
before the first run after deploy is the cheap safety net.

## 3. Restoring

Never restore over production first. Restore to a new project or branch, inspect, then decide.

1. Dashboard, **Database, Backups**: restore a daily backup or a PITR timestamp. Supabase restores into the
   same project (it overwrites the current database and the project is unavailable while it runs), so for a
   first look prefer restoring a manual dump into a scratch project:
   `pg_restore --no-owner --dbname "$SCRATCH_DATABASE_URL" agenticroles-YYYY-MM-DD.dump`.
2. Run the schema contract tests against the restored copy if you have a local Postgres:
   `DATABASE_ADMIN_URL=... ./scripts/test-db.sh` builds its own throwaway database, so for a restored copy just
   check row counts: `jobs`, `employers`, `subscribers`, `digest_runs`.
3. If you restored production in place: re-run the smoke test, then check `/api/ops/report` flags. Anything
   changed between the backup point and now is lost: reconcile paid jobs against Stripe (checkout sessions
   paid after the restore point need `activate_paid_job` replay) and tell affected subscribers if signups
   were lost.
4. Stripe webhooks are idempotent (fulfilment checks the session id), so re-delivering events from the Stripe
   dashboard after a restore is safe and is the way to re-activate paid jobs.

## 4. Restore drill (do once before launch, then quarterly)

Goal: prove a backup is restorable and measure how long it takes. About 30 minutes.

1. Take a manual dump (section 2) or pick yesterday's daily backup.
2. Create a scratch Supabase project (free tier is fine) or a local Postgres.
3. Restore the dump into it.
4. Verify: row counts for `jobs`, `subscribers`, `employers` are within a day of production, and
   `select count(*) from public.jobs where status = 'active' and expires_at > now()` is plausible.
5. Point a local checkout at the scratch project (`.env.local` only) and open `/`, a job page and `/api/health`.
6. Record the date, backup type, restore duration and any surprises at the bottom of this file, then delete the
   scratch project.

### Drill log

| Date | Backup type | Restore time | Result / notes |
|---|---|---|---|
| (not yet run) | | | |
