-- Fix: "DELETE requires a WHERE clause"

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

create or replace function public.reset_delete_pin(new_pin text) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
declare owner text; fresh boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if new_pin !~ '^[0-9]{4}$' then raise exception 'The PIN must be exactly 4 digits.'; end if;
  select value into owner from private.secrets where key = 'owner_email';
  if owner is null or owner <> lower(auth.jwt() ->> 'email') then
    raise exception 'Only the owner can reset the PIN.';
  end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink', 'email/signup')
      and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 600
  ) into fresh;
  if not fresh then raise exception 'Please verify the email code first (codes are valid for 10 minutes).'; end if;
  insert into private.secrets(key, value) values ('delete_pin', crypt(new_pin, gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
  delete from private.pin_failures where true;
end $$;
