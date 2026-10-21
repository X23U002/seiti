# AI のおすすめ巡礼プラン（中継サーバー）

作品ページの「AI におまかせプラン」で使う、Cloudflare Workers のプログラムです。
アプリ → このサーバー → Gemini API とつなぎます。**Gemini の API キーはここにだけ置き、アプリやリポジトリには書きません。**

## しくみ

1. アプリが「作品名」と Firebase のログインの証明（ID トークン）を送る
2. サーバーが、呼び出し元のサイト・ログイン・今日の回数（1人1日 `DAILY_LIMIT` 回）を確かめる
3. その作品の聖地を Firestore から読み、Gemini に「半日で回れるプラン」を JSON で作ってもらう
4. 答えを確かめる（一覧にない聖地は捨てる・数や時間を収める・回る順は近い順に並べ直す）
5. アプリが作品ページに表示し、「地図でこのプランを開く」でルート案内に入る

Gemini は無料枠（請求先アカウントを付けないプロジェクト）で使う想定です。
無料枠では送った内容が Google の改善に使われることがあるため、送るのは**作品名と聖地のデータだけ**にしています。

## 公開の手順（最初の1回）

### 1. Gemini の API キー
1. [Google AI Studio](https://aistudio.google.com/) で「Get API key」→ API キーを作る（請求先アカウントは付けない）
2. 使えるモデル名を確認し、`wrangler.toml` の `GEMINI_MODEL` と合っているか見る（初期値は `gemini-flash-latest`）

### 2. Cloudflare
1. [Cloudflare](https://dash.cloudflare.com/) のアカウントを作る（無料・カード不要）
2. 「Workers KV」で namespace を作り（名前は `seiti-ai-usage` など）、その **ID を `wrangler.toml` の `id` に入れる**
3. 「My Profile → API Tokens」で「Edit Cloudflare Workers」のテンプレートからトークンを作る
4. アカウント ID（ダッシュボードの右側に出る）を控える

### 3. GitHub の Secrets
リポジトリの Settings → Secrets and variables → Actions に、次の3つを登録する。

| 名前 | 中身 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 2-3 で作ったトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 2-4 のアカウント ID |
| `GEMINI_API_KEY` | 1 で作った API キー |

### 4. 公開する
Actions の「AI プランのサーバーを公開」を手で動かす（Run workflow）。
以後は、main の `worker/` が変わるたびに自動で公開されます。

### 5. アプリにつなぐ
公開されると `https://seiti-ai-plan.<アカウントのサブドメイン>.workers.dev` のような URL が出ます。
`map画面/js/ai-plan.js` の `AI_PLAN_ENDPOINT` に、その URL の後ろに `/plan` を付けて入れる
（`python3 tools/update_versions.py` を忘れずに）。

## 手元で動かす

```sh
cd worker
npm ci
npm test                 # 通信しないテスト
```

`npx wrangler dev` で手元でも動かせます（`.dev.vars` に `GEMINI_API_KEY=...` を書く。このファイルはコミットしない）。

## 設定（wrangler.toml の [vars]）

| 名前 | 内容 |
| --- | --- |
| `ALLOWED_ORIGINS` | 呼び出してよいサイト（カンマ区切り） |
| `DAILY_LIMIT` | 1人1日に作れる回数 |
| `GEMINI_MODEL` | 使う Gemini のモデル |
| `FIREBASE_PROJECT_ID` | ログインの証明と聖地の読み込みに使う Firebase のプロジェクト |
