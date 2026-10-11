-- Sri Kangna CRM: reason / note for every staff break
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
alter table public.staff_breaks add column if not exists note text;
