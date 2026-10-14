# メニュー差分チェッカー

販促企画部のグランドメニュー編集作業用の社内アプリです。
店舗ごとに「メニュー変更レコード」（例：A店舗の「秋GM変更」）を作り、変更前と変更後のメニュー資料を読み込んで、追加・削除・価格・名称・カテゴリ・説明の相違を一覧にします。結果はExcel（サマリー／変更商品一覧／新メニュー全体）で出力できます。

## 構成

| 部分 | 置き場所 | 内容 |
|---|---|---|
| 画面 | `index.html`（GitHub Pagesで公開） | 1ファイルの静的ページ |
| データ・ログイン | Supabase プロジェクト `menu-diff` | 店舗、レコード、読み取り結果。部署共通アカウント（パスワードのみで入力）でログインした人だけが読み書きできる |
| 読み取り | `supabase/functions/extract-menu` | ログイン確認後、Claude API に資料を送り商品データ（JSON）を返す |
| DB定義 | `supabase/migrations/` | テーブル、アクセス制限（RLS） |

ファイルの読み込み（Excel・Word・PDF・画像）と比較、Excel出力はブラウザ内で行います。元ファイルはサーバーに保存しません。

## 初回の設定

1. **GitHub Pages**：リポジトリの Settings → Pages で、Source を「Deploy from a branch」、Branch を `main` / `(root)` にして保存。
2. **共通アカウント**：Supabase の Authentication → Users →「Add user」→「Create new user」で、Email に `menu-team@8sin.co.jp`、Password に部署共通のパスワードを入れ、「Auto Confirm User」にチェックして作成。画面ではこのパスワードだけでログインします（メールは送信しません）。パスワードを変えるときは同じ画面でこのユーザーのパスワードを更新します。
3. **Claude APIキー**：Anthropic の管理画面でキーを発行し、Supabase の Edge Functions → Secrets に `ANTHROPIC_API_KEY` という名前で登録（キーはリポジトリに入れない）。

任意の設定（Edge Functions → Secrets）：

- `CLAUDE_MODEL`：読み取りに使うモデル（既定 `claude-sonnet-5-5`）
- `ALLOWED_EMAIL_DOMAIN`：読み取りを許可するアカウントのメールドメイン（既定 `8sin.co.jp`）。共通アカウントのアドレスを変える場合は `index.html` の `sharedEmail`・`emailDomain` と、DB関数 `is_company_user()` も合わせて変更する

## 運用メモ

- 全員が同じアカウントでログインするため、レコードの作成者や読み取りの利用者は個人ごとには記録されません。
- パスワードを知っている人は誰でも使えます。異動・退職などのときはパスワードを変更してください。
- 読み取りの利用量は `extract_logs` テーブルに記録されます（Supabase の Table Editor で確認できます）。

## 画面の更新

`index.html` を編集して `main` に反映すると、数分で公開中の画面が更新されます。
