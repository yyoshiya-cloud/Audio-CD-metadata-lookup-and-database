/**
 * Discogs の認証情報の扱い（検索とLP/EP発売日の取得で共通）。
 * 優先順位: 画面から送られたトークン > サーバーの環境変数 DISCOGS_TOKEN
 * 認証情報は Authorization ヘッダーのみで送る（URLに含めるとアクセスログに残るため）。
 */

/** 環境変数のプレースホルダー（.env.example のままの値）を「未設定」として扱う */
export function isConfiguredValue(value: string | undefined | null): boolean {
  const v = (value ?? '').trim();
  return v !== '' && !/^MY_/i.test(v);
}

export function resolveDiscogsToken(
  explicit?: string,
  env: Record<string, string | undefined> = process.env
): string {
  const fromClient = (explicit ?? '').trim();
  if (fromClient) return fromClient;
  return isConfiguredValue(env.DISCOGS_TOKEN) ? (env.DISCOGS_TOKEN as string).trim() : '';
}

/** "token" / "key:secret" / "key=… secret=…" のいずれの書式でも Authorization ヘッダーの値にする */
export function discogsAuthHeader(rawToken: string): string | undefined {
  const t = rawToken.trim();
  if (!t) return undefined;
  if (t.includes(':') && !t.startsWith('http')) {
    const [key, secret] = t.split(':');
    return `Discogs key=${key.trim()}, secret=${(secret ?? '').trim()}`;
  }
  if (t.includes('key=') || t.includes('secret=')) return `Discogs ${t}`;
  return `Discogs token=${t}`;
}
