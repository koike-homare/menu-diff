# メニュー差分チェッカー

販促企画部のグランドメニュー編集作業用の社内アプリです。
店舗ごとに「メニュー変更レコード」（例：A店舗の「秋GM変更」）を作り、変更前と変更後のメニュー資料を読み込んで、追加・削除・価格・名称・カテゴリ・説明の相違を一覧にします。結果はExcel（サマリー／変更商品一覧／新メニュー全体）で出力できます。

## 構成

| 部分 | 置き場所 | 内容 |
|---|---|---|
| 画面 | `index.html`（GitHub Pagesで公開） | 1ファイルの静的ページ |
| データ・ログイン | Supabase プロジェクト `menu-diff` | 店舗、レコード、読み取り結果。会社ドメインのメールでログインした人だけが読み書きできる |
| 読み取り | `supabase/functions/extract-menu` | ログイン確認後、Claude API に資料を送り商品データ（JSON）を返す |
| DB定義 | `supabase/migrations/` | テーブル、アクセス制限（RLS） |

ファイルの読み込み（Excel・Word・PDF・画像）と比較、Excel出力はブラウザ内で行います。元ファイルはサーバーに保存しません。

## 初回の設定

1. **GitHub Pages**：リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `(root)` にして保存。
2. **ログインの戻り先**：Supabase の Authentication → URL Configuration で、Site URL に GitHub Pages の URL を登録。
3. **Claude APIキー**：Anthropic の管理画面でキーを発行し、Supabase の Edge Functions → Secrets に `ANTHROPIC_API_KEY` という名前で登録（キーはリポジトリに入れない）。

任意の設定（Edge Functions → Secrets）：

- `CLAUDE_MODEL`：読み取りに使うモデル（既定 `claude-sonnet-5-5`）
- `ALLOWED_EMAIL_DOMAIN`：ログインを許可するメールドメイン（既定 `8sin.co.jp`）。変える場合は `index.html` の `emailDomain` と、DB関数 `is_company_user()` も合わせて変更する

## 社内に広げる前に

- Supabase 標準のメール送信は送信数が少なく、Supabase の組織メンバー宛てにしか届きません。Authentication → SMTP Settings で会社のメールサーバーを設定してください。
- 読み取りの利用量は `extract_logs` テーブルに記録されます（Supabase の Table Editor で確認できます）。

## 画面の更新

`index.html` を編集して `main` に反映すると、数分で公開中の画面が更新されます。
