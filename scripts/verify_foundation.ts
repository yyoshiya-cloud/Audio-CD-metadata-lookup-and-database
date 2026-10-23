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
import { sanitizeReadingResults } from '../server/readingSanitizer.ts';
import { listMissingReadings, needsReading } from '../src/lib/readingSort.ts';
import {
  compareSortKeys,
  groupHeading,
  isValidReading,
  normalizeReading,
  normalizeSortKey,
  sortKeyForArtist,
  sortKeyForTitle,
} from '../src/lib/readingSort.ts';
import { TRASH_RETENTION_DAYS, daysUntilPurge, isTrashed, selectExpiredTrashIds, sortTrashNewestFirst, splitTrash } from '../src/lib/trash.ts';
import { discogsAuthHeader, isConfiguredValue, resolveDiscogsToken } from '../server/discogsAuth.ts';
import { getConfigStatus } from '../server/configStatus.ts';
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

console.log('読み仮名と五十音ソート');
await test('読みの整形と妥当性（漢字・カタカナ以外の混入を弾く）', () => {
  assert.equal(normalizeReading('  サザン　オールスターズ '), 'さざん おーるすたーず');
  assert.equal(normalizeReading('ＡＢＣ'), 'ABC');
  assert.equal(normalizeReading(null), '');
  assert.ok(isValidReading('さかみちのしょうじょ'));
  assert.ok(isValidReading('エイ・ビー・シー') && isValidReading('Mr.Children') && isValidReading('ゆず'));
  assert.ok(!isValidReading('坂道の少女')); // 漢字
  assert.ok(!isValidReading(''));
  assert.ok(!isValidReading('・・・'));
});
await test('並べ替えキー: 読みを優先し、かなを揃え、冠詞と記号を除く', () => {
  assert.equal(normalizeSortKey('アイウ'), 'あいう');
  assert.equal(normalizeSortKey('The Beatles'), 'beatles');
  assert.equal(normalizeSortKey('A-ha'), 'aha');
  assert.equal(normalizeSortKey('♪'), '♪');
  assert.equal(sortKeyForTitle({ title: '坂道の少女', titleReading: 'さかみちのしょうじょ' }), 'さかみちのしょうじょ');
  assert.equal(sortKeyForTitle({ title: 'ありがとう' }), 'ありがとう');
  assert.equal(sortKeyForArtist({ artist: 'サザンオールスターズ', artistReading: '' }), 'さざんおーるすたーず');
});
await test('五十音順に並ぶ（漢字は読みで、英字は先、冠詞は無視）', () => {
  const cds = [
    { title: '青春の光と影', titleReading: 'せいしゅんのひかりとかげ' },
    { title: 'アーリーデイズ', titleReading: '' },
    { title: '坂道の少女', titleReading: 'さかみちのしょうじょ' },
    { title: 'The Best' },
    { title: 'ありがとう' },
    { title: '卒業', titleReading: 'そつぎょう' },
    { title: 'Zebra' },
    { title: '1999' },
  ];
  const sorted = [...cds].sort((a, b) => compareSortKeys(sortKeyForTitle(a), sortKeyForTitle(b))).map((c) => c.title);
  // 数字・英字 → あ行 → さ行 → せ → そ の順
  assert.deepEqual(sorted, ['1999', 'The Best', 'Zebra', 'アーリーデイズ', 'ありがとう', '坂道の少女', '青春の光と影', '卒業']);
  // 濁点の違いは同順位（か と が）、小さい「っ」を含んでも崩れない
  assert.ok(compareSortKeys('かさ', 'がさ') === 0);
  assert.ok(compareSortKeys('あ', 'い') < 0 && compareSortKeys('わ', 'ん') < 0);
});
await test('見出し（あ行〜わ行 / A〜Z / 0-9 / その他）', () => {
  assert.equal(groupHeading('あいう'), 'あ');
  assert.equal(groupHeading('がっこう'), 'か');
  assert.equal(groupHeading('ぱ'), 'は');
  assert.equal(groupHeading('っ'), 'た');
  assert.equal(groupHeading('んー'), 'わ');
  assert.equal(groupHeading('zebra'), 'Z');
  assert.equal(groupHeading('1999'), '0-9');
  assert.equal(groupHeading('♪'), 'その他');
  assert.equal(groupHeading(''), 'その他');
});

console.log('AIによる読み仮名の生成');
await test('読みを付ける対象: 漢字を含み、読みが未登録のものだけ（選択があればその中だけ）', () => {
  assert.ok(needsReading('坂道の少女') && needsReading('Mr.沢田') && !needsReading('ありがとう') && !needsReading('Zebra') && !needsReading(''));
  const cds = [
    { id: '1', title: '坂道の少女', artist: '沢田聖子' },
    { id: '2', title: 'ありがとう', artist: 'ゆず' }, // かなだけ → 不要
    { id: '3', title: '卒業', artist: '沢田聖子', titleReading: 'そつぎょう' }, // タイトルは登録済み → 歌手のみ
    { id: '4', title: 'Zebra', artist: 'Band', titleReading: '', artistReading: '' }, // 英字だけ → 不要
    { id: '5', title: '青春', artist: '誰か', titleReading: 'せいしゅん', artistReading: 'だれか' }, // 両方登録済み
  ];
  assert.deepEqual(listMissingReadings(cds), [
    { id: '1', title: '坂道の少女', artist: '沢田聖子' },
    { id: '3', title: undefined, artist: '沢田聖子' },
  ]);
  assert.deepEqual(listMissingReadings(cds, ['3', '5']), [{ id: '3', title: undefined, artist: '沢田聖子' }]);
  assert.deepEqual(listMissingReadings(cds, []).length, 2); // 空の配列は「指定なし」
});
await test('AIの応答の検証: 依頼外のID・漢字混じり・依頼外の項目・重複を捨て、読みを整える', () => {
  const requested = [
    { id: 'a', title: '坂道の少女', artist: '沢田聖子' },
    { id: 'b', title: '卒業' },
    { id: 'c', artist: '誰か' },
  ];
  const raw = {
    results: [
      { id: 'a', titleReading: 'サカミチノショウジョ', artistReading: '沢田聖子' }, // 歌手の読みに漢字 → 捨てる
      { id: 'b', titleReading: 'そつぎょう', artistReading: 'ひつよう' }, // 依頼していない歌手の読み → 捨てる
      { id: 'c', titleReading: 'いらない', artistReading: 'だれか' }, // 依頼していないタイトルの読み → 捨てる
      { id: 'zzz', titleReading: 'ふめい' }, // 依頼していないID
      { id: 'a', titleReading: 'べつ' }, // 重複
      { id: 'b', titleReading: '' }, // 空
      'broken',
    ],
  };
  assert.deepEqual(sanitizeReadingResults(raw, requested), [
    { id: 'a', titleReading: 'さかみちのしょうじょ', artistReading: undefined },
    { id: 'b', titleReading: 'そつぎょう', artistReading: undefined },
    { id: 'c', titleReading: undefined, artistReading: 'だれか' },
  ]);
  assert.deepEqual(sanitizeReadingResults(null, requested), []);
  assert.deepEqual(sanitizeReadingResults({ results: 'x' }, requested), []);
});

console.log('ゴミ箱（削除の取り消し）');
await test('ゴミ箱の振り分け・並び・期限切れの判定・残り日数', () => {
  const DAY = 24 * 3600 * 1000;
  const now = Date.parse('2026-10-20T12:00:00Z');
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
  const cds = [
    { id: 'a' },
    { id: 'b', deletedAt: iso(1) },
    { id: 'c', deletedAt: iso(31) },
    { id: 'd', deletedAt: iso(29.5) },
    { id: 'e', deletedAt: 'broken-date' },
  ];
  assert.ok(!isTrashed(cds[0]) && isTrashed(cds[1]));
  const { active, trashed } = splitTrash(cds);
  assert.deepEqual(active.map((c) => c.id), ['a']);
  assert.deepEqual(trashed.map((c) => c.id), ['b', 'c', 'd', 'e']);
  assert.deepEqual(sortTrashNewestFirst(trashed.slice(0, 3)).map((c) => c.id), ['b', 'd', 'c']);
  // 30日以上前だけが期限切れ（壊れた日付は消さない）
  assert.deepEqual(selectExpiredTrashIds(cds, now), ['c']);
  assert.deepEqual(selectExpiredTrashIds(cds, now, 1), ['b', 'c', 'd']);
  assert.equal(TRASH_RETENTION_DAYS, 30);
  assert.equal(daysUntilPurge({ deletedAt: iso(1) }, now), 29);
  assert.equal(daysUntilPurge({ deletedAt: iso(29.5) }, now), 1);
  assert.equal(daysUntilPurge({ deletedAt: iso(40) }, now), 0);
  assert.equal(daysUntilPurge({}, now), 30);
});

console.log('環境変数のAPIキー');
await test('Discogs: 画面の値 > 環境変数 の優先順位。プレースホルダーは未設定扱い', () => {
  assert.equal(resolveDiscogsToken(' from-ui ', { DISCOGS_TOKEN: 'from-env' }), 'from-ui');
  assert.equal(resolveDiscogsToken('', { DISCOGS_TOKEN: ' from-env ' }), 'from-env');
  assert.equal(resolveDiscogsToken(undefined, {}), '');
  assert.equal(resolveDiscogsToken('', { DISCOGS_TOKEN: 'MY_DISCOGS_TOKEN' }), '');
  assert.ok(!isConfiguredValue('') && !isConfiguredValue('  ') && !isConfiguredValue('MY_GEMINI_API_KEY') && isConfiguredValue('abc'));
});
await test('Discogs: 認証ヘッダーの書式（token / key:secret / key=…）', () => {
  assert.equal(discogsAuthHeader(''), undefined);
  assert.equal(discogsAuthHeader('abc123'), 'Discogs token=abc123');
  assert.equal(discogsAuthHeader('KEY:SECRET'), 'Discogs key=KEY, secret=SECRET');
  assert.equal(discogsAuthHeader('key=K, secret=S'), 'Discogs key=K, secret=S');
});
await test('設定状況の応答は真偽値のみ（キーの値を含まない）', () => {
  const env = { DISCOGS_TOKEN: 'SECRET-VALUE', GEMINI_API_KEY: 'MY_GEMINI_API_KEY', SPOTIFY_CLIENT_ID: 'id', MB_CONTACT: 'a@example.com' };
  const status = getConfigStatus(env);
  assert.deepEqual(status, { discogs: true, spotify: false, rakuten: false, gemini: false, musicbrainzContact: true });
  const json = JSON.stringify(status);
  assert.ok(!json.includes('SECRET-VALUE') && !json.includes('a@example.com'));
  assert.ok(Object.values(status).every((v) => typeof v === 'boolean'));
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
