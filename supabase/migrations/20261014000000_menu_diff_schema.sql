-- メニュー差分チェッカー：データベース構成
-- 会社ドメインのユーザーだけが使えるようにする判定
create or replace function public.is_company_user()
returns boolean language sql stable security invoker set search_path = ''
as $$ select coalesce((auth.jwt() ->> 'email') ilike '%@8sin.co.jp', false) $$;
revoke execute on function public.is_company_user() from anon, public;
grant execute on function public.is_company_user() to authenticated;

-- 店舗
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  last_title text not null default '',
  last_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index stores_name_key on public.stores (name);

-- メニュー変更レコード（一覧に出す要約）
create table public.records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  title text not null check (length(trim(title)) > 0),
  status text not null default '未着手' check (status in ('未着手','確認中','完了')),
  diff_count int,
  left_count int,
  same_count int,
  sources jsonb not null default '{"cur":[],"new":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text default (auth.jwt() ->> 'email')
);
create index records_store_updated_idx on public.records (store_id, updated_at desc);

-- レコードの中身（読み取った商品・確認チェック）
create table public.record_items (
  record_id uuid primary key references public.records(id) on delete cascade,
  cur_items jsonb not null default '[]'::jsonb,
  new_items jsonb not null default '[]'::jsonb,
  done jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 読み取りの利用記録（費用の把握用。Edge Functionだけが書き込む）
create table public.extract_logs (
  id bigint generated always as identity primary key,
  user_email text,
  input_tokens int,
  output_tokens int,
  images int,
  created_at timestamptz not null default now()
);

-- 店舗の「最新のレコード」を自動で更新
create or replace function public.touch_store_from_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare sid uuid;
begin
  sid := coalesce(new.store_id, old.store_id);
  update public.stores s set
    last_title = coalesce((select r.title from public.records r where r.store_id = sid order by r.updated_at desc limit 1), ''),
    last_at = coalesce((select max(r.updated_at) from public.records r where r.store_id = sid), s.created_at)
  where s.id = sid;
  return null;
end $$;
revoke execute on function public.touch_store_from_record() from anon, authenticated, public;
create trigger records_touch_store after insert or update or delete on public.records
  for each row execute function public.touch_store_from_record();

-- RLS
alter table public.stores enable row level security;
alter table public.records enable row level security;
alter table public.record_items enable row level security;
alter table public.extract_logs enable row level security;

create policy "company read stores" on public.stores for select to authenticated using (public.is_company_user());
create policy "company insert stores" on public.stores for insert to authenticated with check (public.is_company_user());
create policy "company update stores" on public.stores for update to authenticated using (public.is_company_user()) with check (public.is_company_user());
create policy "company delete stores" on public.stores for delete to authenticated using (public.is_company_user());

create policy "company read records" on public.records for select to authenticated using (public.is_company_user());
create policy "company insert records" on public.records for insert to authenticated with check (public.is_company_user());
create policy "company update records" on public.records for update to authenticated using (public.is_company_user()) with check (public.is_company_user());
create policy "company delete records" on public.records for delete to authenticated using (public.is_company_user());

create policy "company read items" on public.record_items for select to authenticated using (public.is_company_user());
create policy "company insert items" on public.record_items for insert to authenticated with check (public.is_company_user());
create policy "company update items" on public.record_items for update to authenticated using (public.is_company_user()) with check (public.is_company_user());
create policy "company delete items" on public.record_items for delete to authenticated using (public.is_company_user());

revoke all on public.extract_logs from anon, authenticated;
