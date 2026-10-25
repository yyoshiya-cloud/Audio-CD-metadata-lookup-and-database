import type { CDMetadata } from '../types/cd';

/**
 * ゴミ箱（削除の取り消し）の判定ロジック。純粋関数のみ。
 * CDを削除すると、レコードは消さずに deletedAt（削除日時）を付ける。一覧・検索・書き出し・
 * バックアップには deletedAt のないCDだけが出る。ゴミ箱から復元でき、一定日数が過ぎると完全に削除する。
 */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

type Trashable = Pick<CDMetadata, 'id' | 'deletedAt'>;

export const isTrashed = (cd: Pick<CDMetadata, 'deletedAt'>): boolean => Boolean(cd.deletedAt);

export function splitTrash<T extends Trashable>(cds: T[]): { active: T[]; trashed: T[] } {
  const active: T[] = [];
  const trashed: T[] = [];
  for (const cd of cds) (isTrashed(cd) ? trashed : active).push(cd);
  return { active, trashed };
}

/** 削除日時の新しい順 */
export function sortTrashNewestFirst<T extends Trashable>(cds: T[]): T[] {
  return [...cds].sort((a, b) => Date.parse(b.deletedAt || '') - Date.parse(a.deletedAt || ''));
}

/** 保持期間を過ぎ、完全に削除してよいCDのID */
export function selectExpiredTrashIds<T extends Trashable>(
  cds: T[],
  nowMs: number,
  retentionDays: number = TRASH_RETENTION_DAYS
): string[] {
  return cds
    .filter((cd) => {
      if (!cd.deletedAt) return false;
      const t = Date.parse(cd.deletedAt);
      return Number.isFinite(t) && nowMs - t >= retentionDays * DAY_MS;
    })
    .map((cd) => cd.id);
}

/** 完全に削除されるまでの残り日数（切り上げ。0 以上） */
export function daysUntilPurge(
  cd: Pick<CDMetadata, 'deletedAt'>,
  nowMs: number,
  retentionDays: number = TRASH_RETENTION_DAYS
): number {
  const t = Date.parse(cd.deletedAt || '');
  if (!Number.isFinite(t)) return retentionDays;
  return Math.max(0, Math.ceil((t + retentionDays * DAY_MS - nowMs) / DAY_MS));
}
