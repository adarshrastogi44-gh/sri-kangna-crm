-- Sri Kangna CRM: number of pieces in the jewellery box going on rent
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
alter table public.rentals add column if not exists pieces integer;
