-- Sri Kangna CRM: 4-digit PIN required to delete bills.
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;                      -- not reachable from the app / API
create table if not exists private.secrets (key text primary key, value text not null);
create table if not exists private.pin_failures (at timestamptz not null default now());

-- Is a delete PIN set yet?
create or replace function public.has_delete_pin() returns boolean
language sql security definer set search_path = public, private, extensions as $$
  select exists (select 1 from private.secrets where key = 'delete_pin');
$$;

-- Set the PIN the first time, or change it (current PIN needed to change)
create or replace function public.set_delete_pin(old_pin text, new_pin text) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare h text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if new_pin !~ '^[0-9]{4}$' then raise exception 'The PIN must be exactly 4 digits.'; end if;
  select value into h from private.secrets where key = 'delete_pin';
  if h is not null and (old_pin is null or crypt(old_pin, h) <> h) then
    raise exception 'Current PIN is wrong.';
  end if;
  insert into private.secrets(key, value) values ('delete_pin', crypt(new_pin, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
end $$;

-- Delete a bill only with the right PIN (5 wrong tries = 10 minute lock)
create or replace function public.delete_bill_with_pin(p_bill uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare h text; fails int;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select count(*) into fails from private.pin_failures where at > now() - interval '10 minutes';
  if fails >= 5 then raise exception 'Too many wrong PIN attempts. Please wait 10 minutes.'; end if;
  select value into h from private.secrets where key = 'delete_pin';
  if h is null then raise exception 'No delete PIN is set yet. Set one in Settings first.'; end if;
  if p_pin is null or crypt(p_pin, h) <> h then
    insert into private.pin_failures default values;
    raise exception 'Wrong PIN.';
  end if;
  delete from private.pin_failures where true;
  delete from public.bills where id = p_bill;
  if not found then raise exception 'Bill not found (it may already be deleted).'; end if;
end $$;

revoke all on function public.has_delete_pin() from public, anon;
revoke all on function public.set_delete_pin(text, text) from public, anon;
revoke all on function public.delete_bill_with_pin(uuid, text) from public, anon;
grant execute on function public.has_delete_pin() to authenticated;
grant execute on function public.set_delete_pin(text, text) to authenticated;
grant execute on function public.delete_bill_with_pin(uuid, text) to authenticated;

-- Bills can no longer be deleted directly — only through the PIN check above
revoke delete on public.bills from anon, authenticated;
