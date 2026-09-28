-- Sri Kangna CRM: allow "advance returned" entries for staff
alter table public.staff_advances add column if not exists kind text not null default 'advance';  -- advance | return
