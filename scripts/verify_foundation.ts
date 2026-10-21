/**
 * 基盤モジュール（ロガー・設定ストア・APIキー暗号化・入力検証）の検証。
 * 実行: npm run verify:foundation
 */
import assert from 'node:assert/strict';
import { createLogger, parseLogLevel, type LogSink } from '../src/lib/logger.ts';
import { STORAGE_KEYS, __setStorageForTests, settingsStore } from '../src/lib/settingsStore.ts';
import { decryptJSON, encryptJSON, generateCredentialsKey, isEncryptedPayload } from '../src/lib/secureCredentials.ts';
import { v, validate } from '../server/validate.ts';
import { measureImageFootprint } from '../src/lib/imageFootprint.ts';
import {
  MAX_BATCH_ITEMS,
  aiAnalyzeTagsBodySchema,
  imageProxyQuerySchema,
  itunesTracksQuerySchema,
  ocrBodySchema,
  searchBodySchema,
  vinylLookupBodySchema,
} from '../server/schemas.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, val: string) => {
      data[k] = val;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

console.log('ロガー');
await test('レベルのしきい値で出力を絞り、スコープ名と時刻を付ける', () => {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => calls.push({ level, args });
  const sink: LogSink = { debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  const log = createLogger('search', { sink, level: 'warn' });
  log.debug('d');
  log.info('i');
  log.warn('w', { a: 1 });
  log.error('e');
  assert.deepEqual(calls.map((c) => c.level), ['warn', 'error']);
  assert.deepEqual(calls[0].args, ['[search] w', { a: 1 }]);
  const withTime: unknown[][] = [];
  createLogger('x', { sink: { ...sink, info: (...a) => withTime.push(a) }, level: 'debug', timestamp: true }).info('hello');
  assert.match(String(withTime[0][0]), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[x\] hello$/);
  // 文字列以外（Error など）を先頭に渡しても落ちない
  calls.length = 0;
  log.error(new Error('boom'));
  assert.equal(calls[0].args[0], '[search]');
  assert.ok(calls[0].args[1] instanceof Error);
});
await test('レベル文字列の解釈', () => {
  assert.equal(parseLogLevel('DEBUG'), 'debug');
  assert.equal(parseLogLevel('nope'), 'info');
  assert.equal(parseLogLevel(undefined, 'error'), 'error');
});

console.log('設定ストア');
await test('文字列・真偽値・JSON を読み書きし、壊れた値や保存先なしでも落ちない', () => {
  const st = memoryStorage();
  __setStorageForTests(st);
  assert.equal(settingsStore.getBool(STORAGE_KEYS.headerCompact, true), true); // 未設定は fallback
  settingsStore.setBool(STORAGE_KEYS.headerCompact, false);
  assert.equal(settingsStore.getBool(STORAGE_KEYS.headerCompact, true), false);
  settingsStore.setJSON(STORAGE_KEYS.tableVisibleColumns, { title: true });
  assert.deepEqual(settingsStore.getJSON(STORAGE_KEYS.tableVisibleColumns, {}), { title: true });
  st.data[STORAGE_KEYS.customSetlists] = '{broken';
  assert.deepEqual(settingsStore.getJSON(STORAGE_KEYS.customSetlists, []), []);
  settingsStore.remove(STORAGE_KEYS.headerCompact);
  assert.equal(settingsStore.getString(STORAGE_KEYS.headerCompact), null);
  __setStorageForTests(null);
  assert.equal(settingsStore.setString('k', 'v'), false);
  assert.equal(settingsStore.getString('k'), null);
  __setStorageForTests({
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  });
  assert.equal(settingsStore.getString('k'), null);
  assert.equal(settingsStore.setJSON('k', {}), false);
  settingsStore.remove('k');
  __setStorageForTests(undefined);
});

console.log('APIキーの暗号化');
await test('暗号化→復号で元に戻り、平文が含まれず、同じ内容でも毎回違う暗号文になる', async () => {
  const key = await generateCredentialsKey();
  const creds = { discogsToken: 'SECRET-TOKEN-123', spotifyClientId: 'abc' };
  const p1 = await encryptJSON(key, creds);
  const p2 = await encryptJSON(key, creds);
  assert.ok(isEncryptedPayload(p1));
  assert.ok(!JSON.stringify(p1).includes('SECRET-TOKEN-123'));
  assert.notEqual(p1.data, p2.data);
  assert.deepEqual(await decryptJSON(key, p1), creds);
});
await test('別の鍵・改ざんされた暗号文は復号できない', async () => {
  const k1 = await generateCredentialsKey();
  const k2 = await generateCredentialsKey();
  const p = await encryptJSON(k1, { a: 1 });
  await assert.rejects(() => decryptJSON(k2, p));
  const tampered = { ...p, data: p.data.slice(0, -4) + (p.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
  await assert.rejects(() => decryptJSON(k1, tampered));
  assert.ok(!isEncryptedPayload({ discogsToken: 'x' }));
  assert.ok(!isEncryptedPayload(null));
});
await test('鍵は取り出せない（non-extractable）', async () => {
  const key = await generateCredentialsKey();
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', key));
});

console.log('入力検証');
await test('型・長さ・件数を検証し、未知の項目を取り除く', () => {
  const schema = v.object({
    title: v.optional(v.string({ max: 5 })),
    sources: v.optional(v.array(v.enumOf(['a', 'b'] as const), { max: 2 })),
    limit: v.optional(v.number({ integer: true, min: 1, max: 10 })),
  });
  const ok = validate(schema, { title: ' abc ', sources: ['a'], limit: 3, extra: 'drop' });
  assert.deepEqual(ok, { ok: true, data: { title: 'abc', sources: ['a'], limit: 3 } });
  assert.deepEqual(validate(schema, {}), { ok: true, data: {} });
  assert.ok(!validate(schema, { title: 'toolong' }).ok);
  assert.ok(!validate(schema, { title: 123 }).ok);
  assert.ok(!validate(schema, { sources: ['c'] }).ok);
  assert.ok(!validate(schema, { sources: ['a', 'b', 'a'] }).ok);
  assert.ok(!validate(schema, { limit: 1.5 }).ok);
  assert.ok(!validate(schema, null).ok);
  assert.ok(!validate(schema, [1]).ok);
  const r = validate(schema, { limit: 99 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /limit.*10以下/);
});
await test('JSONサイズの上限', () => {
  const schema = v.object({ apiKeys: v.optional(v.limitedJSON(50)) });
  assert.ok(validate(schema, { apiKeys: { a: 'b' } }).ok);
  assert.ok(!validate(schema, { apiKeys: { a: 'x'.repeat(100) } }).ok);
});

console.log('画像の容量');
await test('埋め込み画像（データURL）とURL参照を数え、容量の目安を出す', () => {
  const dataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  const fp = measureImageFootprint([
    { coverUrl: dataUrl, subImages: [{ id: 's1', type: 'back', imageUrl: 'https://example.com/back.jpg' }] },
    { coverUrl: 'https://example.com/a.jpg', subImages: [{ id: 's2', type: 'obi', imageUrl: dataUrl }, { id: 's3', type: 'disc', imageUrl: '' }] },
    { coverUrl: '', subImages: [] },
  ]);
  assert.deepEqual(fp, { embeddedCount: 2, embeddedBytes: dataUrl.length * 2, linkedCount: 2, cdsWithEmbedded: 2 });
  assert.deepEqual(measureImageFootprint([]), { embeddedCount: 0, embeddedBytes: 0, linkedCount: 0, cdsWithEmbedded: 0 });
});

console.log('APIルートのスキーマ');
await test('検索API: 通常の入力は通り、型違い・長すぎる値・多すぎる件数は弾く', () => {
  const ok = validate(searchBodySchema, { title: 'さくら', artist: '', sources: ['musicbrainz', 'ndl'], apiKeys: { discogsToken: 'x' }, extra: 1 });
  assert.ok(ok.ok);
  if (ok.ok) assert.ok(!('extra' in ok.data));
  assert.ok(validate(searchBodySchema, {}).ok);
  assert.ok(!validate(searchBodySchema, { title: 123 }).ok);
  assert.ok(!validate(searchBodySchema, { title: 'x'.repeat(201) }).ok);
  assert.ok(!validate(searchBodySchema, { sources: Array(13).fill('ndl') }).ok);
  assert.ok(!validate(searchBodySchema, { sources: 'ndl' }).ok);
  assert.ok(!validate(searchBodySchema, { apiKeys: { k: 'x'.repeat(9000) } }).ok);
});
await test('OCR・画像系: 必須項目と大きさ', () => {
  assert.ok(!validate(ocrBodySchema, {}).ok);
  assert.ok(!validate(ocrBodySchema, { imageBase64: '' }).ok);
  assert.ok(!validate(ocrBodySchema, { imageBase64: ['a'] }).ok);
  assert.ok(validate(ocrBodySchema, { imageBase64: 'AAAA', mimeType: 'image/png' }).ok);
  assert.ok(!validate(imageProxyQuerySchema, { url: ['a', 'b'] }).ok); // ?url=a&url=b
  assert.ok(!validate(imageProxyQuerySchema, {}).ok);
  assert.ok(validate(imageProxyQuerySchema, { url: 'https://example.com/a.jpg' }).ok);
  assert.ok(!validate(imageProxyQuerySchema, { url: 'https://example.com/' + 'a'.repeat(2100) }).ok);
  assert.ok(!validate(itunesTracksQuerySchema, {}).ok);
  assert.ok(validate(itunesTracksQuerySchema, { collectionId: '12345' }).ok);
});
await test('一括API: 件数の上限と項目の型', () => {
  const item = { id: 'a', title: 't', artist: 'x', catalogNumber: 'SRCL-1', releaseDate: '2000' };
  assert.ok(validate(vinylLookupBodySchema, { items: [item] }).ok);
  assert.ok(!validate(vinylLookupBodySchema, { items: [] }).ok);
  assert.ok(!validate(vinylLookupBodySchema, { items: Array(MAX_BATCH_ITEMS + 1).fill(item) }).ok);
  assert.ok(!validate(vinylLookupBodySchema, { items: [{ title: 5 }] }).ok);
  assert.ok(validate(aiAnalyzeTagsBodySchema, { cds: [{ id: 'a', title: 't' }] }).ok);
  assert.ok(!validate(aiAnalyzeTagsBodySchema, { cds: ['x'] }).ok);
  assert.ok(!validate(aiAnalyzeTagsBodySchema, { cds: [] }).ok);
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed > 0 ? 1 : 0);
