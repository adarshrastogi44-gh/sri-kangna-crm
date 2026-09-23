-- Sri Kangna CRM: Terms & Conditions on estimates. Run once in Supabase → SQL Editor.
alter table public.shop_settings add column if not exists terms text;
