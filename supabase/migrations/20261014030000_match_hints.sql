-- 同じ商品の書き方違い（Claudeの判定結果）
alter table public.record_items add column match_hints jsonb not null default '[]'::jsonb;
