-- House Expenses – Supabase schema (already applied to project opcdzjjnuauhjdtmanic)
-- Only e-mail addresses in household_members can read/write anything (RLS), even if others sign up.

create table public.household_members (email text primary key, display_name text, created_at timestamptz not null default now());

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members m
                 where lower(m.email) = lower(coalesce((select auth.jwt()) ->> 'email', '')));
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

create table public.categories (name text primary key, sort int not null default 0);
create table public.people (name text primary key, sort int not null default 0);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  sheet_name text not null check (sheet_name ~ '^[A-Z][a-z]{2}_[0-9]{4}$'),  -- e.g. Oct_2026 = workbook sheet
  expense_date date not null,
  category text not null,
  amount numeric(12,2) not null,
  amount_formula text,          -- e.g. 32.9+23.41, written back to Excel as a formula
  purchased_by text,
  remarks text,
  receipt_path text,            -- object in the private "receipts" bucket
  ocr_text text,
  sort_order int not null default 0,   -- row order inside the sheet (row 4 onwards)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_sheet_idx on public.expenses (sheet_name, sort_order);
create index expenses_date_idx on public.expenses (expense_date);
create index expenses_created_by_idx on public.expenses (created_by);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();

alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.people enable row level security;
alter table public.expenses enable row level security;

create policy "members read members" on public.household_members for select to authenticated using ((select public.is_member()));
create policy "members manage members" on public.household_members for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members all categories" on public.categories for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members all people" on public.people for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members all expenses" on public.expenses for all to authenticated using ((select public.is_member())) with check ((select public.is_member()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('receipts','receipts',false,15728640), ('templates','templates',false,15728640) on conflict (id) do nothing;

create policy "members read files" on storage.objects for select to authenticated using (bucket_id in ('receipts','templates') and (select public.is_member()));
create policy "members insert files" on storage.objects for insert to authenticated with check (bucket_id in ('receipts','templates') and (select public.is_member()));
create policy "members update files" on storage.objects for update to authenticated using (bucket_id in ('receipts','templates') and (select public.is_member()));
create policy "members delete files" on storage.objects for delete to authenticated using (bucket_id in ('receipts','templates') and (select public.is_member()));
