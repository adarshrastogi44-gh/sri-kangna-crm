-- Sri Kangna CRM: allow bills that are not paid in full to be saved
alter table public.bills drop constraint if exists bills_payment_status_check;
