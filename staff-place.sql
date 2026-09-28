-- Sri Kangna CRM: separate Home staff and Shop staff
alter table public.staff add column if not exists place text not null default 'shop';  -- shop | home
