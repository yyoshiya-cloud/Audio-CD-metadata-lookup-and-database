# CDメタデータ検索＆データベース

CDの題名・型番(規格品番)・バーコードから複数のデータベースを横断検索し、結果をブラウザ内のデータベースに保存し、JSON・Excel・CSVで書き出し・読み込みできるWebアプリです。JSONは自動バックアップにも対応しています。

## 主な機能

- **横断検索**: MusicBrainz / Discogs / iTunes / 国立国会図書館(NDL)（Spotify・楽天ブックスは現在無効。下記参照）
  - 型番・バーコードのみの検索では、先にCD系DBで正確な題名・アーティストを特定してからストリーミング系を検索
- **AI支援(Gemini)**: 検索結果の統合・検証、背表紙のOCR、ジャケット画像の高画質化、AIタグ付け、メタデータ補完
- **データ管理**: ダッシュボード、重複チェック、ジャケットギャラリー、曲名検索とセットリスト、一括インポート・編集
- **入出力・バックアップ**: JSON / Excel / CSV の書き出し・読み込み、JSON自動バックアップ、PDFカタログ（Googleスプレッドシート連携は廃止）

## 技術構成

- フロントエンド: React 19, Vite, Tailwind CSS, Dexie(IndexedDB)
- バックエンド: Express(`server.ts`、tsxで実行)
- 認証: Firebase Authentication(Googleアカウントでのログインのみ。Sheets/Driveの権限は要求しません)

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
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | 任意 | Spotify検索（現在無効） |
| `RAKUTEN_APP_ID` | 任意 | 楽天ブックス検索（現在無効） |
| `MB_CONTACT` | 任意 | MusicBrainz の User-Agent に含める連絡先(メールまたはURL) |
| `TRUST_PROXY` | 任意 | リバースプロキシ配下の場合のみ `1`(レート制限のIP判定用) |
| `PORT` | 任意 | サーバーポート(既定 3000) |

### スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド(`dist/`) |
| `npm start` | 本番サーバー起動 |
| `npm run typecheck` | 型チェック(`tsc --noEmit`) |
| `npm run lint` / `lint:fix` | ESLint（既存コードの違反は warn。新規コードは warn も出さない方針） |
| `npm run format` / `format:check` | Prettier による整形 / 整形の確認（既存ファイルは未整形のため、最初は差分が大きくなります） |
| `npm test` | ロジックのテスト（基盤 / 検索 / 自動バックアップ）。外部APIには接続しません |
| `npm run test:ui` | 画面部品のテスト（Vitest + Testing Library） |
| `npm run verify` | 総合検証。サーバーを起動した状態で実行します（実APIへ接続するテストを含む） |
| `npm run check` | 型チェック + lint + `npm test` をまとめて実行 |

CI（GitHub Actions: `.github/workflows/ci.yml`）で、型チェック・lint・テストを実行します。

## コード構成

```
server.ts                  Express サーバー（各APIルート。入力は server/schemas.ts で検証）
server/
  search.ts / searchMerge.ts / searchUtils.ts   検索の横断実行・統合・正規化
  musicbrainz.ts discogs.ts itunes.ts ndl.ts …  各APIの検索（応答の型は apiTypes.ts）
  validate.ts / schemas.ts                      依存パッケージなしの入力検証と各APIのスキーマ
src/
  App.tsx                  画面の組み立て（状態は hooks に分離）
  hooks/                   useToast / useDisplaySettings / useSearchPreviewMode / useAutoBackup
  config/sources.ts        有効な検索ソースとAPI名の表示ラベル（一元管理）
  lib/
    settingsStore.ts       localStorage の読み書き（キーは STORAGE_KEYS に集約）
    logger.ts              共通ロガー（console を直接使わない）
    secureCredentials.ts   APIキーの暗号化（AES-GCM）
    db.ts                  IndexedDB（Dexie）。APIキーは暗号化して保存
    tabularFormat.ts       Excel / CSV / JSON の共通変換
  components/Modal.tsx     共通モーダル（Esc・背景クリック・フォーカス循環）
  components/detail/       CD詳細モーダルのタブ（トラックリスト・API間比較）
```

### APIキーの保管について

APIキーはブラウザのIndexedDBに **AES-GCM で暗号化して**保存します（鍵は取り出せない形で同じIndexedDBに保持）。ディスクやDBの中身を覗かれても、平文のキーは残りません。ただし、ページ内で悪意あるスクリプトが動いた場合（XSS）は、同じページのJSが鍵を使って復号できるため防げません。公開環境では、キーをサーバーの環境変数（`.env`）に置く運用を推奨します。旧バージョンが保存した平文のキーは、初回の読み込み時に暗号化へ移行し、平文のコピーを削除します。

## JSON自動バックアップ

ライブラリ画面の「自動バックアップ」から設定します。

- **保存先**: Chrome / Edge では、選んだフォルダにJSONを自動で保存し、古い世代を自動整理します（クラウド同期フォルダを選ぶと別の場所にも複製されます）。Firefox / Safari などでは、ブラウザのダウンロードとして保存します（世代の自動整理は不可）。
- **実行タイミング**: 有効にすると、データに変更があり、前回から設定した間隔（1時間 / 6時間 / 1日 / 1週間）が過ぎていれば、アプリを開いている間に自動で保存します。データ変更の20秒後、10分ごとの確認、タブを閉じる・切り替えるときに判定します。ライブラリが空のときは保存しません。
- **復元**: 設定画面のバックアップ一覧から「復元」を押します。同じCDは上書きして統合し、ないCDは追加します（現在のデータは削除しません）。任意のJSONファイルは「書き出し・読み込み」の「読み込み」からも読み込めます。
- **注意**: ブラウザを再起動すると、フォルダへのアクセス許可をもう一度求められることがあります（設定画面の「許可する」を押してください）。バックアップにはCDの情報（タグ・評価・メモ・収録曲・ジャケット画像を含む）が入り、カスタムセットリスト・タグのプリセット・APIキーは含まれません。
- Chrome / Edge は、ドキュメント・ダウンロード・デスクトップなどの標準フォルダ自体を保存先に選ばせません。その中に専用フォルダ（例: `ドキュメント\CD-Backup`）を作って選んでください。
- ブラウザのサイトデータを消すとアプリのデータも消えるため、バックアップ先はブラウザの外（フォルダ）にしてください。

## 検索ソースの有効/無効

使用する検索APIは `src/config/sources.ts` の `ENABLED_SOURCES` で管理しています（サーバーと画面の両方がこの一覧を参照します）。

- 現在は **Spotify と楽天ブックス CD検索を無効化**しています。検索対象・設定画面の入力欄・件数表示から外れ、サーバーもこれらのソースを呼びません。
- 実装コード（`server/spotify.ts`、`server/rakuten.ts`、設定画面の入力欄）は残してあります。再び使うときは `ENABLED_SOURCES` に `'spotify'` / `'rakuten'` を追加するだけです。
- 保存済みのAPIキーは削除していません。

## Firebase設定について

`firebase-applet-config.json` のAPIキー等はFirebase Webアプリ用の公開前提の値で、秘密情報ではありません。ただし、悪用を防ぐため次を推奨します。

- Firebaseコンソールで、APIキーの利用元(HTTPリファラー)を自分のドメインに制限する
- Authentication の承認済みドメインを必要なものだけにする
- Firestoreは未使用のため、`firestore.rules` で全アクセスを拒否している(`firebase deploy --only firestore:rules` で反映)

## 注意

- Googleスプレッドシート連携は廃止しました。ログインはアカウント表示のみに使われ、アクセストークンは保持しません。旧バージョンが保存したスプレッドシート用の連携情報は、起動時に自動で削除されます。
- 外部画像の取得にはSSRF対策(`server/security.ts`)とレート制限が入っています。
- 各APIの入力は `server/schemas.ts` で型・長さ・件数を検証します（不正な入力は 400 を返します）。
