# Monitoring runbook

Three signals cover the launch: is the site up, is the data healthy, and did the daily ingest run.

## 1. Uptime: `/api/health`

`GET /api/health` is unauthenticated, returns `200 {"status":"ok","database":"ok","latencyMs":N}` when the
database answers and `503` with `"status":"degraded"` otherwise (`misconfigured` means missing env vars,
`unreachable` means the database call threw). It is `no-store`, so a monitor always sees the live state.

Set up any external uptime monitor (UptimeRobot, Better Stack, Pingdom, a Vercel-integrated one):

| Setting | Value |
|---|---|
| URL | `https://<prod>/api/health` |
| Method | GET |
| Expect | HTTP 200 (optionally keyword `"status":"ok"`) |
| Interval | 1 to 5 minutes |
| Alert after | 2 consecutive failures, to email and a phone push |
| Also monitor | `https://<prod>/` (homepage renders) |

A 503 with `database: "misconfigured"` after a deploy usually means an environment variable is missing in
Vercel. A sustained `unreachable` means check the Supabase status page and project health.

## 2. Data health: `/api/ops/report`

`GET /api/ops/report` needs `Authorization: Bearer $CRON_SECRET` and returns `{ generatedAt, stats, flags,
summary }`. Each flag has `level` (`critical`, `warning`, `info`), a stable `code` and a message. Poll it once or
twice a day from anything that can run a scheduled HTTP request and alert on `critical`:

```bash
# Prints critical flags and exits non-zero when there is one. CRON_SECRET comes from the environment
# (a CI secret or your shell), never from an argument or a file in the repo.
curl -fsS -H "Authorization: Bearer ${CRON_SECRET:?}" "https://<prod>/api/ops/report" \
  | jq -e '[.flags[] | select(.level == "critical")] | length == 0' >/dev/null \
  || { echo "critical ops flag(s) present"; exit 1; }
```

Options for running it on a schedule:

- A GitHub Actions scheduled workflow with `CRON_SECRET` and `SITE_URL` as repository secrets (add it only
  when you are ready to store the secret; this repo does not ship one so that it needs no secrets to merge).
  Failed scheduled runs email the workflow owner.
- The uptime monitor's "API check" feature with a custom header, if it supports one.

Flag codes you will see:

| Code | Level | Meaning and first action |
|---|---|---|
| `no_live_jobs` | critical | The board is empty. Check ingestion and the admin console |
| `ingestion_failed` | warning | A source's last run failed or its board is missing (404). Check `ingestion_runs` and the run log |
| `ingestion_close_skipped` | warning | The mass-close rail refused to close many live jobs for one source. See section 3 |
| `ingestion_stale` | warning | A source has had no successful run for days |
| `digest_stuck` | warning | The weekly digest crashed mid-send. Re-running is safe (deliveries are deduplicated) |

## 3. Ingestion failures: GitHub Actions

`.github/workflows/ingest.yml` runs daily at 11:15 UTC and runs the CLI with `--strict`, so any failed source
(including a board that 404s) turns the run red instead of passing quietly. A source that would close more than
`max(5, 50%)` of its live jobs in one run is not closed: the run exits non-zero with status `close_skipped`
and an `ALERT` log line.

Notification, with no extra secrets: on a failed **scheduled** run the "Notify on failure" step opens (or
comments on) one issue labelled `ingest-failure` using the built-in `GITHUB_TOKEN`. Watching the repo (Watch,
Custom, Issues) turns that into email or mobile push. GitHub also emails the workflow owner on failed
scheduled runs; check the account's notification settings (Actions: "Send notifications for failed workflows
only"). Close the issue once resolved; a new one opens on the next failure.

Triage:

1. Open the run, read the `ingest-summary` artifact (per-source status, counts, errors).
2. `fetch_failed`: the provider had an outage or changed its API. Usually self-heals next run; if it
   persists, run `python -m agentjobs_ingest run --dry-run --source provider:board` locally.
3. `not_found`: the board token changed. Fix `ingestion/sources.yaml` or remove the source.
4. `close_skipped`: a source dropped most of its roles. Look at the company's careers page. If the drop is
   real (roles pulled or reclassified), re-run the workflow manually (Run workflow) with `force_close`
   enabled, for that `source` only. If it looks like a provider glitch, do nothing: the next run reconciles.
5. `db_failed`: check Supabase health and that migrations are applied (an unapplied migration shows up as an
   RPC error in `error`).

## 4. Other alerts worth wiring

- Vercel: Project settings, Notifications: failed production deployments and cron failures.
- Stripe: Developers, Webhooks: alert on failing endpoint deliveries (a failed webhook means a paid job may
  not have activated).
- Supabase: Project settings, Notifications: disk and egress thresholds.
