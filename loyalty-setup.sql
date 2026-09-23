-- Sri Kangna CRM: redeem loyalty points on bills (1 point = Rs. 1). Run once in Supabase → SQL Editor.
alter table public.bills add column if not exists points_redeemed integer not null default 0;
alter table public.bills drop constraint if exists bills_points_redeemed_check;
alter table public.bills add constraint bills_points_redeemed_check check (points_redeemed >= 0);
