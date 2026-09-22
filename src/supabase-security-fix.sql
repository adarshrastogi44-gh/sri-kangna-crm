-- Optional but recommended: stop the public (anon) key from reading the monthly summary view.
-- Run once in Supabase → SQL Editor.
alter view public.customer_monthly_summary set (security_invoker = true);
revoke all on public.customer_monthly_summary from anon;
