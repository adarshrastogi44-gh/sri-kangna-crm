-- Sri Kangna CRM: advance balance is reduced when you pay less salary
alter table public.staff_payments add column if not exists adv_cut numeric not null default 0;
-- allow a payment of ₹0 cash when the whole salary goes towards the advance
alter table public.staff_payments drop constraint if exists staff_payments_amount_check;
alter table public.staff_payments add constraint staff_payments_amount_check check (amount >= 0);
-- (also needed if not run before)
alter table public.staff_advances add column if not exists kind text not null default 'advance';
