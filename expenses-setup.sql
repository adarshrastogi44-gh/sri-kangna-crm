-- Sri Kangna CRM: Expense sheet (expenses, bank deposits, cash taken from the shop)
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  entry_at timestamptz not null default now(),        -- date and time
  kind text not null default 'expense',                -- expense | deposit | withdrawal
  category text not null default 'Other',              -- Water, Battery rent, TV recharge, Ration, ...
  amount numeric not null check (amount > 0),
  person text,                                         -- who paid / who deposited / who took the cash
  mode text not null default 'cash',                   -- cash | upi | card | bank
  note text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_entry_at_idx on public.expenses (entry_at);

alter table public.expenses enable row level security;
drop policy if exists "Signed-in users manage expenses" on public.expenses;
create policy "Signed-in users manage expenses" on public.expenses
  for all to authenticated using (true) with check (true);
