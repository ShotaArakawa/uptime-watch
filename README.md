# かんたん死活監視(uptime-watch)

URL を登録すると定期的にアクセスして確認し、サイトが落ちたらメールや Slack / Discord で知らせる、小さな死活監視サービスの雛形です。

## 概要

- 登録した URL に Cloudflare Workers の cron(毎分起動)から GET でアクセスし、2xx / 3xx なら正常、それ以外・接続失敗・タイムアウト(10 秒)なら失敗とみなす
- **2 回続けて失敗したら「停止」** と判定して通知し、成功に戻ったら停止時間つきで「復旧」を通知する(一時的な揺れで通知を乱発しないため)
- 画面では稼働率・平均応答時間・直近 30 回の結果バー・通知履歴を表示する

雛形では外部サービスを一切使いません。通知はコンソール出力のモック、保存はメモリ(Worker)/ localStorage(画面のデモ)です。

## 想定ユーザー

- 個人・小規模事業者で、自社サイトや予約ページ、EC サイトを持っているがサーバー監視の仕組みはない人
- 受託でクライアントのサイトを複数保守しているフリーランス・制作会社
- 個人開発者(趣味のサービスや API が落ちていないかだけ知りたい)

大手監視 SaaS は高機能だが英語・高価・設定が多いので、「日本語で、URL を貼るだけで、安い」を狙う。

## MVP の機能

| 機能 | 雛形の状態 |
| --- | --- |
| URL 登録(名前・チェック間隔) | ✅ 入力検査(http/https のみ、ID・パスワード入り URL 禁止、ローカル・プライベートアドレス禁止、重複禁止) |
| 定期チェック | ✅ Workers の `scheduled`(cron `* * * * *`)で、間隔が来た URL だけチェック。同時 5 本まで |
| 停止・復旧の判定 | ✅ 連続 2 回失敗で停止、成功で復旧。停止中は再通知しない |
| ステータス表示 | ✅ 概要タイル、URL ごとの状態・稼働率・平均応答・結果バー |
| 通知 | 🟡 `Notifier` インターフェース。コンソール出力のモックと、Slack / Discord の Webhook 送信の骨格(`WEBHOOK_URL` 設定時のみ) |
| 通知履歴 | ✅ 停止・復旧のイベントを新しい順に保存・表示 |
| プラン制限 | 🟡 無料 3 件・最短 5 分 / 有料(モック)50 件・最短 1 分。課金は未実装 |
| ログイン・複数ユーザー | ❌ 未実装(次にやること) |

## 構成

```
src/core/      監視ロジック(画面と Worker で共用)
  check.ts       HTTP チェッカー / デモ用の模擬チェッカー
  status.ts      停止・復旧の判定、稼働率など
  plan.ts        プラン制限、URL 検査(SSRF 対策の簡易版)
  service.ts     期限が来たものをチェック → 保存 → 通知(cron からも画面からも呼ぶ)
  notifier.ts    通知の差し替えポイント(コンソール / Webhook)
  repo.ts        保存の差し替えポイント(今はメモリ)
src/api.ts     画面のデータ取得。LocalApi(デモ)と HttpApi(Workers)
src/App.tsx    画面
worker/        Cloudflare Workers のエントリ(API + cron)
wrangler.toml  Workers の設定(cron トリガー)
```

- フロント: Vite 6 + React 18 + TypeScript(静的サイトとして Cloudflare Pages に置く想定)
- API・定期実行: Cloudflare Workers(Cron Triggers)。無料枠で動かせる
- 保存: 本実装では D1(または Supabase)に差し替える

## 動かし方

```bash
npm install
npm run dev        # http://localhost:5173 (デモモード。ブラウザ内で模擬チェック)
npm test           # 判定・プラン・チェッカー・通知のテスト
npm run build      # 型チェック(画面 + Worker)と本番ビルド
```

デモモードでは、ブラウザから任意の URL には CORS の制約でアクセスできないため、チェックは模擬です。各 URL の「障害を模擬」ボタンで失敗させると、2 回目のチェックで「停止」になり、解除すると「復旧」が通知履歴に出ます。

### Worker(API + cron)をローカルで動かす

```bash
npm run worker:dev   # http://localhost:8787 (wrangler dev。ログイン不要)
# 別ターミナルで
curl -X POST localhost:8787/api/monitors -H 'content-type: application/json' \
  -d '{"name":"vite","url":"http://localhost:5173/","intervalMin":5}'
curl -X POST 'localhost:8787/api/check?force=1'     # 今すぐ全部チェック
curl 'localhost:8787/__scheduled?cron=*+*+*+*+*'    # cron を手動で発火
```

`worker:dev` はローカル検証のため `ALLOW_PRIVATE_HOSTS=1` で localhost への監視を許可しています。画面から Worker を使うときは `.env.example` を `.env` にコピーして `VITE_API_BASE=http://localhost:8787` を設定します。

| API | 内容 |
| --- | --- |
| `GET /api/monitors` | 一覧 |
| `POST /api/monitors` | 登録 `{ name, url, intervalMin }` |
| `DELETE /api/monitors/:id` | 削除 |
| `POST /api/check?force=1` | チェック実行(`force` なしなら間隔が来たものだけ) |
| `GET /api/events` | 通知履歴 |

## 収益化案

- 月額の段階課金(監視 URL 数とチェック間隔で差をつける)
  - 無料: 3 URL・5 分間隔・メール通知のみ
  - ライト(月 300〜500 円): 20 URL・1 分間隔・Slack / Discord / LINE 通知
  - 制作会社向け(月 2,000 円前後): 100 URL・クライアント別のステータスページ・月次の稼働レポート PDF
- オプション: 公開ステータスページの独自ドメイン、SSL 証明書・ドメインの期限切れ通知、応答の遅さアラート
- Workers の無料枠・低単価で原価が小さいので、低価格帯でも利益が出やすい

## 集客案

- 「サイト 落ちた 気づかない」「死活監視 無料」「WordPress 監視」などの検索向けに、原因別の解説記事と無料プランへの導線
- 公開ステータスページに「Powered by かんたん死活監視」を入れて利用者のサイトから流入させる(有料で非表示)
- 制作会社・フリーランス向けに「保守契約の付加価値に使える」切り口で X / note に事例を書く
- 自分の他サービス(band-ticket など)の監視に実際に使い、稼働率の実績を公開する

## 次にやること

1. 保存を D1 に差し替える(`MonitorRepo` の実装を追加。監視対象・直近の結果・イベントのテーブル)
2. ログイン(Supabase Auth または Cloudflare Access)と、ユーザーごとのデータ分離
3. 通知の本実装: メール(Resend 等)、Slack / Discord Webhook の画面からの登録と送信テスト、LINE
4. SSRF 対策の強化(名前解決後の IP 判定、リダイレクト先の再検査)
5. 監視対象が増えた時の分散(Queues で 1 件ずつ処理、cron 1 回あたりの実行時間制限への対応)
6. チェックを複数拠点から行い、両方失敗した時だけ停止とする(誤検知対策)
7. 公開ステータスページ、稼働レポート
8. 課金(Stripe)と利用規約・特商法表記、Cloudflare Pages / Workers のデプロイ設定
