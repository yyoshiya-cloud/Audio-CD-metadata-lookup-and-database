/**
 * サーバーの環境変数で設定済みのAPIキーの有無（GET /api/config-status の応答）。
 * 真偽値のみで、キーの値は画面に送られない。
 */
export interface ConfigStatus {
  discogs: boolean;
  spotify: boolean;
  rakuten: boolean;
  gemini: boolean;
  musicbrainzContact: boolean;
}
