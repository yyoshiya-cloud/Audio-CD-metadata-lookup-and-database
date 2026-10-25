/**
 * 自動バックアップの判定ロジックの検証（ブラウザ・外部APIには接続しない）。
 * 実行: npm run verify:backup
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_BACKUP_SETTINGS,
  SETTINGS_KEY,
  STATE_KEY,
  backupFileName,
  decideBackup,
  fingerprintCDs,
  isBackupFileName,
  loadBackupSettings,
  loadBackupState,
  saveBackupSettings,
  saveBackupState,
  selectFilesToDelete,
  formatBytes,
} from '../src/lib/autoBackupCore.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const HOUR = 3600 * 1000;
const on = { ...DEFAULT_BACKUP_SETTINGS, enabled: true, intervalHours: 24 };
const now = Date.parse('2026-10-18T12:00:00Z');

console.log('ファイル名と世代管理');
test('ファイル名は時刻順に並び、アプリのバックアップ名だけを判定する', () => {
  const n = backupFileName(new Date(2026, 9, 18, 14, 25, 30));
  assert.equal(n, 'cd-backup_20261018-142530.json');
  assert.ok(isBackupFileName(n));
  assert.ok(!isBackupFileName('cd-backup_20261018.json'));
  assert.ok(!isBackupFileName('my-notes.json'));
  assert.ok(!isBackupFileName('cd-backup_20261018-142530.json.bak'));
});
test('古い世代だけを削除対象にし、他のファイルは対象にしない', () => {
  const names = [
    'cd-backup_20261015-100000.json',
    'cd-backup_20261018-100000.json',
    'cd-backup_20261016-100000.json',
    'cd-backup_20261017-100000.json',
    'cd-backup_20261014-100000.json',
    'family-photos.json',
    'readme.txt',
  ];
  assert.deepEqual(selectFilesToDelete(names, 3), ['cd-backup_20261015-100000.json', 'cd-backup_20261014-100000.json']);
  assert.deepEqual(selectFilesToDelete(names, 0), []);
  assert.deepEqual(selectFilesToDelete(names, 10), []);
});

console.log('データの指紋');
test('追加・削除・編集で指紋が変わり、同じ内容なら同じ', () => {
  const a = [{ id: 'a', updatedAt: '1' }, { id: 'b', updatedAt: '2' }];
  assert.equal(fingerprintCDs(a), fingerprintCDs([...a]));
  assert.notEqual(fingerprintCDs(a), fingerprintCDs([...a, { id: 'c', updatedAt: '3' }]));
  assert.notEqual(fingerprintCDs(a), fingerprintCDs([a[0]]));
  assert.notEqual(fingerprintCDs(a), fingerprintCDs([{ id: 'a', updatedAt: '1' }, { id: 'b', updatedAt: '9' }]));
  // updatedAt が変わらない編集（タイトル・評価・タグ・メモ）も検出する
  const base = [{ id: 'a', updatedAt: '1', title: 'T', rating: 3, tags: ['x'], notes: 'n' }];
  assert.notEqual(fingerprintCDs(base), fingerprintCDs([{ ...base[0], title: 'T2' }]));
  assert.notEqual(fingerprintCDs(base), fingerprintCDs([{ ...base[0], rating: 4 }]));
  assert.notEqual(fingerprintCDs(base), fingerprintCDs([{ ...base[0], tags: ['x', 'y'] }]));
  assert.notEqual(fingerprintCDs(base), fingerprintCDs([{ ...base[0], notes: 'nn' }]));
});

console.log('実行判定');
test('無効 / 空 / 未変更 / 間隔未満 / 実行', () => {
  const fp = 'x';
  assert.deepEqual(decideBackup({ settings: DEFAULT_BACKUP_SETTINGS, state: {}, fingerprint: fp, count: 5, now }), { run: false, reason: 'disabled' });
  assert.deepEqual(decideBackup({ settings: on, state: {}, fingerprint: fp, count: 0, now }), { run: false, reason: 'empty' });
  assert.deepEqual(
    decideBackup({ settings: on, state: { lastFingerprint: fp, lastBackupAt: new Date(now - 100 * HOUR).toISOString() }, fingerprint: fp, count: 5, now }),
    { run: false, reason: 'unchanged' }
  );
  assert.deepEqual(
    decideBackup({ settings: on, state: { lastFingerprint: 'old', lastBackupAt: new Date(now - 23 * HOUR).toISOString() }, fingerprint: fp, count: 5, now }),
    { run: false, reason: 'not-due' }
  );
  assert.deepEqual(
    decideBackup({ settings: on, state: { lastFingerprint: 'old', lastBackupAt: new Date(now - 25 * HOUR).toISOString() }, fingerprint: fp, count: 5, now }),
    { run: true, reason: 'due' }
  );
  // 初回（バックアップ履歴なし）は、間隔を待たずに実行
  assert.deepEqual(decideBackup({ settings: on, state: {}, fingerprint: fp, count: 5, now }), { run: true, reason: 'due' });
});

console.log('設定の保存と読み込み');
test('不正な保存値は既定値に戻る / 往復できる', () => {
  const st = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ enabled: 'yes', intervalHours: 7, keepCount: 99, destination: 'x' }) });
  assert.deepEqual(loadBackupSettings(st), { ...DEFAULT_BACKUP_SETTINGS, enabled: false, destination: 'folder' });
  const s = { enabled: true, intervalHours: 6, keepCount: 30, destination: 'download' as const };
  saveBackupSettings(st, s);
  assert.deepEqual(loadBackupSettings(st), s);
  assert.deepEqual(loadBackupSettings(fakeStorage({ [SETTINGS_KEY]: '{broken' })), DEFAULT_BACKUP_SETTINGS);
  const stt = fakeStorage();
  saveBackupState(stt, { lastBackupAt: 'a', lastFingerprint: 'f' });
  assert.deepEqual(loadBackupState(stt), { lastBackupAt: 'a', lastFingerprint: 'f' });
  assert.deepEqual(loadBackupState(fakeStorage({ [STATE_KEY]: 'null' })), {});
});
test('サイズ表示', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed > 0 ? 1 : 0);
