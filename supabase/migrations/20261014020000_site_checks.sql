-- グルメサイト照合の保存
alter table public.record_items add column site_checks jsonb not null default '[]'::jsonb;
alter table public.records add column sites_need_update int;
