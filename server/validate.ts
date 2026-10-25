/**
 * 依存パッケージなしの小さな入力検証（zod 相当の最小機能）。
 * リクエストボディの型・長さ・件数を検証し、想定外の入力を早い段階で弾く。
 * 使い方: const r = validate(schema, req.body); if (!r.ok) return res.status(400).json({ error: r.error });
 */
export type Schema<T> = (value: unknown, path: string) => T;

export class ValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

const fail = (path: string, message: string): never => {
  throw new ValidationError(path, message);
};

export const v = {
  string(opts: { min?: number; max?: number; trim?: boolean; allowEmpty?: boolean } = {}): Schema<string> {
    return (value, path) => {
      if (typeof value !== 'string') return fail(path, '文字列で指定してください');
      const s = opts.trim === false ? value : value.trim();
      if (!opts.allowEmpty && opts.min === undefined && s === '') return fail(path, '空にできません');
      if (opts.min !== undefined && s.length < opts.min) return fail(path, `${opts.min}文字以上で指定してください`);
      if (opts.max !== undefined && s.length > opts.max) return fail(path, `${opts.max}文字以内で指定してください`);
      return s;
    };
  },

  number(opts: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
    return (value, path) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, '数値で指定してください');
      if (opts.integer && !Number.isInteger(value)) return fail(path, '整数で指定してください');
      if (opts.min !== undefined && value < opts.min) return fail(path, `${opts.min}以上で指定してください`);
      if (opts.max !== undefined && value > opts.max) return fail(path, `${opts.max}以下で指定してください`);
      return value;
    };
  },

  boolean(): Schema<boolean> {
    return (value, path) => (typeof value === 'boolean' ? value : fail(path, '真偽値で指定してください'));
  },

  enumOf<T extends string>(allowed: readonly T[]): Schema<T> {
    return (value, path) =>
      typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fail(path, `次のいずれかを指定してください: ${allowed.join(', ')}`);
  },

  array<T>(item: Schema<T>, opts: { max?: number; min?: number } = {}): Schema<T[]> {
    return (value, path) => {
      if (!Array.isArray(value)) return fail(path, '配列で指定してください');
      if (opts.max !== undefined && value.length > opts.max) return fail(path, `${opts.max}件以内で指定してください`);
      if (opts.min !== undefined && value.length < opts.min) return fail(path, `${opts.min}件以上で指定してください`);
      return value.map((x, i) => item(x, `${path}[${i}]`));
    };
  },

  /** 指定した項目だけを検証して返す（未知の項目は取り除く）。optional で包んだ項目は省略可 */
  object<S extends Record<string, Schema<any>>>(shape: S): Schema<{ [K in keyof S]: ReturnType<S[K]> }> {
    return (value, path) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'オブジェクトで指定してください');
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const child = (value as Record<string, unknown>)[key];
        const result = shape[key](child, path ? `${path}.${key}` : key);
        if (result !== undefined) out[key] = result;
      }
      return out as { [K in keyof S]: ReturnType<S[K]> };
    };
  },

  /** 省略（undefined / null）を許す */
  optional<T>(inner: Schema<T>): Schema<T | undefined> {
    return (value, path) => (value === undefined || value === null ? undefined : inner(value, path));
  },

  /** 中身は検証せず、オブジェクトであることと大きさだけを確認する（CDの全項目など、別の層で扱う項目用） */
  anyObject(maxBytes: number): Schema<Record<string, unknown>> {
    return (value, path) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'オブジェクトで指定してください');
      try {
        if (JSON.stringify(value).length > maxBytes) return fail(path, `サイズが大きすぎます（${maxBytes}バイトまで）`);
      } catch {
        return fail(path, 'JSONとして扱えない値です');
      }
      return value as Record<string, unknown>;
    };
  },

  /** 検証せずそのまま通す（APIキーなど、別の層で扱う項目用）。大きさだけ制限する */
  limitedJSON(maxBytes: number): Schema<unknown> {
    return (value, path) => {
      try {
        if (JSON.stringify(value ?? null).length > maxBytes) return fail(path, `サイズが大きすぎます（${maxBytes}バイトまで）`);
      } catch {
        return fail(path, 'JSONとして扱えない値です');
      }
      return value;
    };
  },
};

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function validate<T>(schema: Schema<T>, value: unknown): ValidationResult<T> {
  try {
    return { ok: true, data: schema(value, '') };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: `入力が正しくありません（${err.message}）` };
    throw err;
  }
}
