-- Abandoned Stripe Checkout sessions (Stripe expires them after 24h) move a
-- job from pending_payment to payment_expired.
--
-- Kept in its own migration: PostgreSQL cannot use a newly added enum value in
-- the same transaction that adds it, and later migrations reference it.
alter type public.job_status add value if not exists 'payment_expired' after 'pending_payment';
