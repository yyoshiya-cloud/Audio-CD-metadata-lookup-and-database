/**
 * APIキー（Discogs・Spotify・楽天など）を保存するときの暗号化。
 *
 * - AES-GCM 256bit。鍵は「取り出せない（non-extractable）」CryptoKey として IndexedDB に置く。
 *   （このファイルは暗号化・復号の純粋な部分だけ。鍵の保存は db.ts が行う）
 * - 守れるもの: IndexedDB/ディスクの中身を覗かれたとき、バックアップやメモリダンプに平文キーが残らないこと
 * - 守れないもの: ページ内で悪意あるスクリプトが動いた（XSS）場合。その場合は同じページの JS が鍵を使って復号できる
 *   本格的に守るなら、キーをサーバー側の環境変数に置く運用にすること
 */

export interface EncryptedPayload {
  v: 1;
  iv: string; // base64
  data: string; // base64
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  const o = value as EncryptedPayload | null;
  return !!o && typeof o === 'object' && o.v === 1 && typeof o.iv === 'string' && typeof o.data === 'string';
}

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

const fromBase64 = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export async function generateCredentialsKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { v: 1, iv: toBase64(iv), data: toBase64(cipher) };
}

/** 復号に失敗（鍵違い・改ざん）した場合は例外を投げる */
export async function decryptJSON<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.data)
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
