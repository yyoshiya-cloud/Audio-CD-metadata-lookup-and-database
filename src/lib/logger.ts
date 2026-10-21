/**
 * 共通ロガー（ブラウザ・サーバー兼用）。
 * - レベル: debug < info < warn < error。しきい値未満は出力しない（既定は info 以上）
 * - どこで出たか分かるようスコア名（ファイル名など）を付ける
 * - しきい値の変更: サーバーは環境変数 LOG_LEVEL、ブラウザは localStorage の cd_log_level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogSink {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface Logger {
  debug: (message: unknown, ...meta: unknown[]) => void;
  info: (message: unknown, ...meta: unknown[]) => void;
  warn: (message: unknown, ...meta: unknown[]) => void;
  error: (message: unknown, ...meta: unknown[]) => void;
}

export function parseLogLevel(value: unknown, fallback: LogLevel = 'info'): LogLevel {
  return typeof value === 'string' && value.toLowerCase() in ORDER ? (value.toLowerCase() as LogLevel) : fallback;
}

function configuredLevel(): LogLevel {
  try {
    if (typeof process !== 'undefined' && process.env?.LOG_LEVEL) return parseLogLevel(process.env.LOG_LEVEL);
  } catch {
    // process が無いブラウザ環境
  }
  try {
    if (typeof window !== 'undefined') return parseLogLevel(window.localStorage.getItem('cd_log_level'));
  } catch {
    // localStorage が使えない環境
  }
  return 'info';
}

export interface LoggerOptions {
  /** 出力先（テスト用に差し替え可能）。既定は console */
  sink?: LogSink;
  /** 最小レベル。省略時は LOG_LEVEL / cd_log_level を毎回参照する */
  level?: LogLevel;
  /** 先頭に時刻を付ける（サーバー向け） */
  timestamp?: boolean;
}

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const emit = (level: LogLevel, message: unknown, meta: unknown[]) => {
    const min = options.level ?? configuredLevel();
    if (ORDER[level] < ORDER[min]) return;
    const sink = options.sink ?? console;
    const prefix = `${options.timestamp ? `${new Date().toISOString()} ` : ''}[${scope}]`;
    const head = typeof message === 'string' ? `${prefix} ${message}` : prefix;
    const rest = typeof message === 'string' ? meta : [message, ...meta];
    sink[level](head, ...rest);
  };
  return {
    debug: (m, ...meta) => emit('debug', m, meta),
    info: (m, ...meta) => emit('info', m, meta),
    warn: (m, ...meta) => emit('warn', m, meta),
    error: (m, ...meta) => emit('error', m, meta),
  };
}
