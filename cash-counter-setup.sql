-- Sri Kangna CRM: payment mode on bills + daily cash counter
alter table public.bills add column if not exists pay_mode text not null default 'cash';   -- cash | upi | card | split
alter table public.bills add column if not exists cash_part numeric;                          -- cash portion when "Cash + UPI"

create table if not exists public.cash_days (
  day date primary key,
  opening numeric not null default 0,      -- cash in the counter when the shop opened
  counted numeric,                         -- cash actually counted at closing (optional)
  note text,
  updated_at timestamptz not null default now()
);
alter table public.cash_days enable row level security;
drop policy if exists "Signed-in users manage cash days" on public.cash_days;
create policy "Signed-in users manage cash days" on public.cash_days for all to authenticated using (true) with check (true);
