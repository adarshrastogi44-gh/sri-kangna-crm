-- Sri Kangna CRM: separate Home expenses and Shop expenses
alter table public.expenses add column if not exists place text not null default 'shop';   -- shop | home
-- move existing home-type entries (Ration etc.) to Home expenses
update public.expenses set place = 'home'
  where kind = 'expense' and place = 'shop'
    and category in ('Ration', 'Vegetables', 'Milk', 'Gas cylinder', 'Medicine', 'School fees', 'House rent', 'Maid', 'Fruits');
