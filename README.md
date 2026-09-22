# Sri Kangna CRM

Customer CRM for Sri Kangna, built with React + Vite on top of the existing Supabase database
(tables: customers, visits, bills, followups, profiles).

## Features
- Dashboard: this month's sales, collections, visits, repeat visitors, pending dues, follow-ups due, upcoming birthdays/anniversaries, top customers
- Customers: search, add, edit, full history (bills, visits, follow-ups), Call / WhatsApp links
- Visits and Bills by month; bills track paid / partial / unpaid and dues
- Follow-ups with overdue flags
- Reports: monthly per-customer visits & purchases, "Good customers" (Loyal / Repeat / One-time over 3, 6 or 12 months), month-by-month trend, CSV downloads

## Deploy (Vercel)
Environment variables (already set): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Framework preset: Vite. Build command `npm run build`, output `dist`.

## Logging in
Staff sign in with email + password. Create accounts in Supabase → Authentication → Users → Add user
(tick "Auto confirm user").

## Notes
- Bill payment status is saved as `paid`, `partial` or `unpaid`; follow-up status as `pending` or `done`.
- `supabase-security-fix.sql` closes public access to the `customer_monthly_summary` view.
