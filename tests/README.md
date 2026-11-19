# 自動テスト

`map画面/` の各画面をブラウザ（Playwright）で開いて確かめるテストです。
Firebase と Mapbox への通信はすべて `mocks/` と `helpers.js` で差しかえるので、
本番のデータベースには触りません。

## 動かし方

```sh
cd tests
npm ci
npx playwright install chromium   # 初回だけ
npm test
```

- 画面のファイル（.js / .css）を変えたら、コミットの前に
  `python3 tools/update_versions.py` でキャッシュ用の番号（`?v=`）を更新してください。
- GitHub では、プルリクエストごとに `.github/workflows/test.yml` が
  番号のチェックとこのテストを動かします。

## 中身

| ファイル | 内容 |
| --- | --- |
| `helpers.js` | 通信の差しかえ・データの入れ方（`seed`）・エラーの確認 |
| `mocks/firestore.js` | Firestore（モジュール版）の代わり。セキュリティルールの主な決まりも確かめる |
| `mocks/compat.js` | 地図のスタンプ処理が使う Firestore（compat 版）の代わり |
| `mocks/auth.js` | ログインの代わり |
| `fixtures/spots.json` | テスト用の聖地のデータ |
| `specs/` | テスト本体 |
