
-- 参考サイト（店舗ごと）
alter table public.stores add column ref_urls jsonb not null default '[]'::jsonb
  check (jsonb_typeof(ref_urls) = 'array' and jsonb_array_length(ref_urls) <= 30);
