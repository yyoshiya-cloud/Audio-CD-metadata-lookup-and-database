# CDメタデータ検索＆データベース

CDの題名・型番(規格品番)・バーコードから複数のデータベースを横断検索し、結果をブラウザ内のデータベースに保存して、Googleスプレッドシートへ同期・書き出しできるWebアプリです。

## 主な機能

- **横断検索**: MusicBrainz / Discogs / iTunes / 国立国会図書館(NDL) / Spotify / 楽天ブックス
  - 型番・バーコードのみの検索では、先にCD系DBで正確な題名・アーティストを特定してからストリーミング系を検索
- **AI支援(Gemini)**: 検索結果の統合・検証、背表紙のOCR、ジャケット画像の高画質化、AIタグ付け、メタデータ補完
- **データ管理**: ダッシュボード、重複チェック、ジャケットギャラリー、曲名検索とセットリスト、一括インポート・編集
- **入出力**: CSV / Excel / JSON / PDFカタログ / Googleスプレッドシート同期

## 技術構成

- フロントエンド: React 19, Vite, Tailwind CSS, Dexie(IndexedDB)
- バックエンド: Express(`server.ts`、tsxで実行)
- 認証: Firebase Authentication(Google OAuth。スプレッドシート/Driveのスコープ取得のみに使用)

## セットアップ

```bash
bun install        # または npm install
cp .env.example .env
# .env を編集してAPIキーを設定
npm run dev        # http://localhost:3000
```

### 環境変数

| 変数 | 必須 | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | 必須 | AI機能(統合・OCR・タグ付けなど) |
| `DISCOGS_TOKEN` | 任意 | Discogs検索 |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | 任意 | Spotify検索 |
| `RAKUTEN_APP_ID` | 任意 | 楽天ブックス検索(未設定の場合、楽天は検索されません) |
| `MB_CONTACT` | 任意 | MusicBrainz の User-Agent に含める連絡先(メールまたはURL) |
| `TRUST_PROXY` | 任意 | リバースプロキシ配下の場合のみ `1`(レート制限のIP判定用) |
| `PORT` | 任意 | サーバーポート(既定 3000) |

### スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド(`dist/`) |
| `npm start` | 本番サーバー起動 |
| `npm run lint` | 型チェック |
| `npm run verify` | ユーティリティ関数の検証スクリプト |
| `npm run verify:search` | 検索ロジック(正規化・統合・スコアリング・各ソースの解析)の検証。外部APIには接続しません |

## Firebase設定について

`firebase-applet-config.json` のAPIキー等はFirebase Webアプリ用の公開前提の値で、秘密情報ではありません。ただし、悪用を防ぐため次を推奨します。

- Firebaseコンソールで、APIキーの利用元(HTTPリファラー)を自分のドメインに制限する
- Authentication の承認済みドメインを必要なものだけにする
- Firestoreは未使用のため、`firestore.rules` で全アクセスを拒否している(`firebase deploy --only firestore:rules` で反映)

## 注意

- Googleのアクセストークンはメモリ上のみで保持し、ブラウザのストレージには保存しません。ページを再読み込みするとトークンは失われ、スプレッドシート操作時に再ログイン(ポップアップ)を求められます。
- 外部画像の取得にはSSRF対策(`server/security.ts`)とレート制限が入っています。
