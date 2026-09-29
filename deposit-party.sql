-- Sri Kangna CRM: link a bank deposit to a party payment (one entry updates both)
alter table public.expenses add column if not exists party_id uuid references public.parties(id) on delete set null;
alter table public.expenses add column if not exists party_entry_id uuid references public.party_entries(id) on delete set null;
