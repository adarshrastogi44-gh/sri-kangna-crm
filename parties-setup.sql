-- Sri Kangna CRM: Party (supplier) accounts — purchases and payments for each party
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.party_entries (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  kind text not null default 'purchase',        -- purchase | payment
  amount numeric not null check (amount > 0),
  entry_at timestamptz not null default now(),  -- date and time
  bill_no text,                                  -- party's bill / invoice no.
  mode text,                                     -- cash | upi | bank | cheque (for payments)
  note text,
  created_at timestamptz not null default now()
);
create index if not exists party_entries_party_idx on public.party_entries (party_id, entry_at);

alter table public.parties enable row level security;
drop policy if exists "Signed-in users manage parties" on public.parties;
create policy "Signed-in users manage parties" on public.parties for all to authenticated using (true) with check (true);

alter table public.party_entries enable row level security;
drop policy if exists "Signed-in users manage party entries" on public.party_entries;
create policy "Signed-in users manage party entries" on public.party_entries for all to authenticated using (true) with check (true);

-- Your parties (you can add more from the CRM)
insert into public.parties (name) values
  ('A.B. Jewellers'), ('Chawla Jewellery'), ('Brite Sales'), ('Annu Collection'),
  ('Jaintex Jewellers'), ('Manyata Bangles'), ('Sukkan Bangles')
on conflict (name) do nothing;
