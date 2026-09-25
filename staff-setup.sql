-- Sri Kangna CRM: Staff, attendance, breaks, advances and salary
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  role text,
  monthly_salary numeric not null default 0,
  join_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  status text not null default 'present',          -- present | half | absent | leave
  time_in timestamptz,
  time_out timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (staff_id, work_date)
);

create table if not exists public.staff_breaks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  break_start timestamptz not null default now(),
  break_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  amount numeric not null check (amount > 0),
  given_at timestamptz not null default now(),     -- date and time the advance was given
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  month text not null,                             -- salary month, e.g. 2026-09
  amount numeric not null check (amount > 0),
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists staff_att_date_idx on public.staff_attendance (work_date);
create index if not exists staff_breaks_date_idx on public.staff_breaks (work_date);
create index if not exists staff_adv_date_idx on public.staff_advances (given_at);
create index if not exists staff_pay_month_idx on public.staff_payments (month);

do $$
declare t text;
begin
  foreach t in array array['staff','staff_attendance','staff_breaks','staff_advances','staff_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Signed-in users manage %s" on public.%I', t, t);
    execute format('create policy "Signed-in users manage %s" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end $$;
