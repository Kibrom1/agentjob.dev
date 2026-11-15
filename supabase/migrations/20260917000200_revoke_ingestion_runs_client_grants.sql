-- ingestion_runs has RLS enabled with no policies, but Supabase's default
-- privileges still grant table access to anon/authenticated. Remove the grants
-- so the table is closed to clients at both layers (grant and RLS), matching
-- rate_limits, digest_runs and digest_deliveries. service_role is unaffected.
revoke all on public.ingestion_runs from anon, authenticated;
