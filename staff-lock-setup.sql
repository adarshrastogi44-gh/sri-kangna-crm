-- Sri Kangna CRM: password (4-digit PIN) to open the Staff page.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
create table if not exists private.secrets (key text primary key, value text not null);
create table if not exists private.staff_pin_failures (at timestamptz not null default now());

-- Is a staff password set yet?
create or replace function public.has_staff_pin() returns boolean
language sql security definer set search_path = public, private, extensions as $$
  select exists (select 1 from private.secrets where key = 'staff_pin');
$$;

-- Set it the first time, or change it (current password needed to change)
create or replace function public.set_staff_pin(old_pin text, new_pin text) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare h text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if new_pin !~ '^[0-9]{4}$' then raise exception 'The password must be exactly 4 digits.'; end if;
  select value into h from private.secrets where key = 'staff_pin';
  if h is not null and (old_pin is null or crypt(old_pin, h) <> h) then
    raise exception 'Current password is wrong.';
  end if;
  insert into private.secrets(key, value) values ('staff_pin', crypt(new_pin, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
  insert into private.secrets(key, value) values ('owner_email', lower(auth.jwt() ->> 'email'))
  on conflict (key) do nothing;
end $$;

-- Check the password (5 wrong tries = 10 minute lock)
create or replace function public.check_staff_pin(p_pin text) returns boolean
language plpgsql security definer set search_path = public, private, extensions as $$
declare h text; fails int;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select count(*) into fails from private.staff_pin_failures where at > now() - interval '10 minutes';
  if fails >= 5 then raise exception 'Too many wrong tries. Please wait 10 minutes.'; end if;
  select value into h from private.secrets where key = 'staff_pin';
  if h is null then return true; end if;
  if p_pin is null or crypt(p_pin, h) <> h then
    insert into private.staff_pin_failures default values;
    return false;
  end if;
  delete from private.staff_pin_failures where true;
  return true;
end $$;

-- Forgot password: only the owner, within 10 minutes of verifying an email code
create or replace function public.reset_staff_pin(new_pin text) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare owner text; fresh boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if new_pin !~ '^[0-9]{4}$' then raise exception 'The password must be exactly 4 digits.'; end if;
  select value into owner from private.secrets where key = 'owner_email';
  if owner is not null and owner <> lower(auth.jwt() ->> 'email') then
    raise exception 'Only the owner can reset the staff password.';
  end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink', 'email/signup')
      and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 600
  ) into fresh;
  if not fresh then raise exception 'Please verify the email code first (codes are valid for 10 minutes).'; end if;
  insert into private.secrets(key, value) values ('staff_pin', crypt(new_pin, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
  delete from private.staff_pin_failures where true;
end $$;

revoke all on function public.has_staff_pin() from public, anon;
revoke all on function public.set_staff_pin(text, text) from public, anon;
revoke all on function public.check_staff_pin(text) from public, anon;
revoke all on function public.reset_staff_pin(text) from public, anon;
grant execute on function public.has_staff_pin() to authenticated;
grant execute on function public.set_staff_pin(text, text) to authenticated;
grant execute on function public.check_staff_pin(text) to authenticated;
grant execute on function public.reset_staff_pin(text) to authenticated;
