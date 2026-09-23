-- Sri Kangna CRM: extra setup for Items, Customer tags and Shop settings.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

-- 1) Item list used when making bills
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  price numeric default 0,   -- not used; price is entered on each bill
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;
drop policy if exists "Signed-in staff manage products" on public.products;
create policy "Signed-in staff manage products" on public.products
  for all to authenticated using (true) with check (true);

-- 2) Tags on customers (VIP, Regular, Wholesale, ...)
alter table public.customers add column if not exists tags text[] not null default '{}';

-- 3) Shop details printed on bills and used in WhatsApp messages
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  shop_name text not null default 'Sri Kangna',
  address text,
  phone text,
  gstin text,
  bill_footer text default 'Thank you for shopping with us!'
);
insert into public.shop_settings (id) values (1) on conflict (id) do nothing;
alter table public.shop_settings enable row level security;
drop policy if exists "Signed-in staff manage settings" on public.shop_settings;
create policy "Signed-in staff manage settings" on public.shop_settings
  for all to authenticated using (true) with check (true);

-- 4) Allow any visit type (Purchase, Walk-in, Enquiry, ...)
alter table public.visits drop constraint if exists visits_visit_type_check;
