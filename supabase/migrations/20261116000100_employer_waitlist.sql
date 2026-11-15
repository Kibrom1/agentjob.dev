-- =============================================================================
-- Employer waitlist: interest captured from /post-a-job while paid posting is
-- "coming soon". Written only by the server (service_role); no client grants
-- and no RLS policies, so anon/authenticated can neither read nor write it.
-- =============================================================================

create table public.employer_waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (public.is_valid_email(email)),
  company    text not null check (char_length(btrim(company)) between 1 and 120),
  role_note  text check (role_note is null or char_length(role_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employer_waitlist enable row level security;

-- Supabase grants ALL on new public tables to anon/authenticated by default.
revoke all on public.employer_waitlist from public, anon, authenticated;
grant all on public.employer_waitlist to service_role;
