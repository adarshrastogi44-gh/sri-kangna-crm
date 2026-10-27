-- Sri Kangna CRM: "Cash & UPI & Card" on one bill — saves the card part separately
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
alter table public.bills add column if not exists pay_mode text not null default 'cash';
alter table public.bills add column if not exists cash_part numeric;
alter table public.bills add column if not exists card_part numeric;
