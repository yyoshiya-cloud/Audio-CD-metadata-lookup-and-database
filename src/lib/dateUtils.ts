/**
 * Utility functions for formatting timestamps in Japan Standard Time (JST, UTC+9),
 * validating calendar dates (including leap years and month lengths) and track durations,
 * and normalizing dates and catalog numbers across the application.
 */

const JST_FORMATTER = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function getJSTParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const parts = JST_FORMATTER.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return {
    year: map.year || '2026',
    month: map.month || '01',
    day: map.day || '01',
    hour: map.hour === '24' ? '00' : map.hour || '00',
    minute: map.minute || '00',
    second: map.second || '00',
  };
}

/**
 * Returns current timestamp formatted in JST ISO string e.g. "2026-10-01T22:27:41+09:00"
 */
export function getJSTISOString(): string {
  const p = getJSTParts(new Date());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}

/**
 * Formats a date into JST compact timestamp e.g. "20261006175438" (YYYYMMDDHHMMSS)
 */
export function formatJSTTimestampCompact(dateInput: string | Date | number = new Date()): string {
  const date = new Date(dateInput);
  const d = isNaN(date.getTime()) ? new Date() : date;
  const p = getJSTParts(d);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

/**
 * Formats a date or date string into JST format e.g. "YYYY-MM-DD HH:MM:SS" (2026-10-01 22:27:41)
 */
export function formatJSTDateTime(dateInput?: string | Date | number): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return String(dateInput);
  const p = getJSTParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Formats a date string into short JST format e.g. "10/01 23:54:12"
 */
export function formatJSTShort(dateInput?: string | Date | number): string {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const p = getJSTParts(date);
  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Determines whether a given 4-digit year is a leap year (うるう年).
 * Rule: divisible by 4, except centuries not divisible by 400.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the maximum valid day of the month for a given year and month:
 * - 1, 3, 5, 7, 8, 10, 12月 -> 31日
 * - 4, 6, 9, 11月 -> 30日
 * - 2月 -> うるう年なら29日、平年なら28日
 * - それ以外の月（< 1 または > 12）-> 0
 */
export function getMaxDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return isLeapYear(year) ? 29 : 28;
}

/**
 * Validates year, month, and optional day according to strict calendar rules:
 * - Month must be 1..12 (rejects > 12 or < 1)
 * - Day must be 1..getMaxDaysInMonth(year, month)
 */
export function checkCalendarYMD(
  year: number,
  month?: number,
  day?: number
): { valid: boolean; error?: string } {
  if (isNaN(year) || year < 1000 || year > 9999) {
    return { valid: false, error: '年は4桁（例: 1989）で入力してください' };
  }
  if (month !== undefined) {
    if (isNaN(month) || month < 1 || month > 12) {
      return {
        valid: false,
        error: `ありえない月数（${month}月）です。1〜12月の範囲で入力してください`,
      };
    }
    if (day !== undefined) {
      const maxDays = getMaxDaysInMonth(year, month);
      if (isNaN(day) || day < 1 || day > maxDays) {
        if (month === 2) {
          const leap = isLeapYear(year);
          return {
            valid: false,
            error: leap
              ? `${year}年（うるう年）の2月は29日までです（入力値: ${day}日）`
              : `${year}年（平年）の2月は28日までです（入力値: ${day}日）`,
          };
        }
        return {
          valid: false,
          error: `${month}月は${maxDays}日までです（ありえない日数: ${day}日）`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Convert full-width alphanumeric and symbols to half-width,
 * and normalize catalog number to UPPERCASE (e.g. "vicl-123" -> "VICL-123", "ｖｉｃｌ－１２３" -> "VICL-123")
 */
export function normalizeCatalogNumber(raw?: string | null): string {
  if (!raw) return '';

  let str = String(raw).trim();
  str = str.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  str = str.replace(/　/g, ' ');
  str = str.replace(/[‐‑‒–—―ー−ｰ]/g, '-');
  str = str.toUpperCase();

  return str.trim();
}

/**
 * Validates and normalizes a date input string.
 * Rejects impossible months (> 12 or < 1) and impossible days
 * (e.g. >31 for 1,3,5,7,8,10,12; >30 for 4,6,9,11; >28 or >29 for Feb depending on leap year).
 */
export function validateDateInput(raw?: string | number | null): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  if (raw === undefined || raw === null) {
    return { valid: true, normalized: '' };
  }

  let str = String(raw).trim();
  if (!str) {
    return { valid: true, normalized: '' };
  }

  // Convert full-width alphanumeric/symbols to half-width
  str = str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[ー—―－−–]/g, '-')
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .trim();

  // 1. Check numeric Excel / Google Sheets serial date (5-digit integer between 10000 and 60000, not 6/8-digit YYYYMM/YYYYMMDD)
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    if (num >= 10000 && num <= 60000) {
      const epochMs = new Date(Date.UTC(1899, 11, 30)).getTime();
      const dateMs = epochMs + Math.floor(num) * 86400 * 1000;
      const d = new Date(dateMs);
      if (!isNaN(d.getTime())) {
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        if (year >= 1920 && year <= 2040) {
          return { valid: true, normalized: `${year}-${month}-${day}` };
        }
      }
    }
  }

  // 2. Convert Japanese Wareki era formats: 昭和N年, 平成N年, 令和N年, 大正N年
  const warekiMatch = str.match(
    /^(昭和|平成|令和|大正|S|H|R|T)(\d{1,2}|元)[年\.\/-]?(\d{1,2})?[月\.\/-]?(\d{1,2})?日?$/i
  );
  if (warekiMatch) {
    const eraName = warekiMatch[1].toUpperCase();
    const eraYearStr = warekiMatch[2];
    const eraYear = eraYearStr === '元' ? 1 : parseInt(eraYearStr, 10);
    let adYear = 0;
    if (eraName === '昭和' || eraName === 'S') adYear = 1925 + eraYear;
    else if (eraName === '平成' || eraName === 'H') adYear = 1988 + eraYear;
    else if (eraName === '令和' || eraName === 'R') adYear = 2018 + eraYear;
    else if (eraName === '大正' || eraName === 'T') adYear = 1911 + eraYear;

    if (adYear > 0) {
      const mNum = warekiMatch[3] ? parseInt(warekiMatch[3], 10) : undefined;
      const dNum = warekiMatch[4] ? parseInt(warekiMatch[4], 10) : undefined;
      const check = checkCalendarYMD(adYear, mNum, dNum);
      if (!check.valid) {
        return { valid: false, normalized: '', error: check.error };
      }
      if (mNum !== undefined && dNum !== undefined) {
        return {
          valid: true,
          normalized: `${adYear}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`,
        };
      }
      if (mNum !== undefined) {
        return {
          valid: true,
          normalized: `${adYear}-${String(mNum).padStart(2, '0')}`,
        };
      }
      return { valid: true, normalized: `${adYear}` };
    }
  }

  // 3. Pure 8-digit YYYYMMDD (e.g. "19890421" or "20230229")
  if (/^\d{8}$/.test(str)) {
    const yNum = parseInt(str.slice(0, 4), 10);
    const mNum = parseInt(str.slice(4, 6), 10);
    const dNum = parseInt(str.slice(6, 8), 10);
    const check = checkCalendarYMD(yNum, mNum, dNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return {
      valid: true,
      normalized: `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`,
    };
  }

  // 4. Pure 6-digit YYYYMM (e.g. "199805")
  if (/^\d{6}$/.test(str)) {
    const yNum = parseInt(str.slice(0, 4), 10);
    const mNum = parseInt(str.slice(4, 6), 10);
    const check = checkCalendarYMD(yNum, mNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return {
      valid: true,
      normalized: `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}`,
    };
  }

  // 5. Pure 4-digit YYYY (e.g. "1998")
  if (/^\d{4}$/.test(str)) {
    const yNum = parseInt(str, 10);
    const check = checkCalendarYMD(yNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return { valid: true, normalized: str };
  }

  // 6. Replace Japanese date delimiters like "1998年5月21日" or "1998/5/21" or "1998.5.21"
  let cleaned = str.replace(/[年月日]/g, (match) => (match === '日' ? '' : '-'));
  cleaned = cleaned.replace(/[\/\.]/g, '-').replace(/\s+/g, '').replace(/-+$/, '');

  // Handle "1994-1130" (YYYY-MMDD)
  const yMmddMatch = cleaned.match(/^(\d{4})-(\d{4})$/);
  if (yMmddMatch) {
    const yNum = parseInt(yMmddMatch[1], 10);
    const mNum = parseInt(yMmddMatch[2].slice(0, 2), 10);
    const dNum = parseInt(yMmddMatch[2].slice(2, 4), 10);
    const check = checkCalendarYMD(yNum, mNum, dNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return {
      valid: true,
      normalized: `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`,
    };
  }

  // Match YYYY-MM-DD or YYYY-M-D
  const ymdMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const yNum = parseInt(ymdMatch[1], 10);
    const mNum = parseInt(ymdMatch[2], 10);
    const dNum = parseInt(ymdMatch[3], 10);
    const check = checkCalendarYMD(yNum, mNum, dNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return {
      valid: true,
      normalized: `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`,
    };
  }

  // Match YYYY-MM or YYYY-M
  const ymMatch = cleaned.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    const yNum = parseInt(ymMatch[1], 10);
    const mNum = parseInt(ymMatch[2], 10);
    const check = checkCalendarYMD(yNum, mNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return {
      valid: true,
      normalized: `${String(yNum).padStart(4, '0')}-${String(mNum).padStart(2, '0')}`,
    };
  }

  // Match 4-digit Year after stripping
  if (/^\d{4}$/.test(cleaned)) {
    const yNum = parseInt(cleaned, 10);
    const check = checkCalendarYMD(yNum);
    if (!check.valid) {
      return { valid: false, normalized: '', error: check.error };
    }
    return { valid: true, normalized: cleaned };
  }

  return {
    valid: false,
    normalized: '',
    error: '日付の形式が正しくありません（YYYY-MM-DD または 8桁数字で入力してください）',
  };
}

/**
 * Normalizes any release date format into a standard clean date string
 * e.g. "1998-05-21" or "1998-05" or "1998".
 * Returns empty string "" if the date has an impossible month (>12) or impossible day (e.g. non-leap Feb 29, Apr 31).
 */
export function normalizeReleaseDate(raw?: string | number | null): string {
  const res = validateDateInput(raw);
  return res.valid ? res.normalized : '';
}

/**
 * Validates and formats a track duration string into "MM:SS".
 * Rejects impossible minutes (> 60) and impossible seconds (>= 60).
 */
export function validateTrackDuration(raw?: string | null): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  if (raw === undefined || raw === null) {
    return { valid: true, normalized: '' };
  }

  let trimmed = String(raw).trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  // Full-width numbers & colons to half-width
  trimmed = trimmed
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    .replace(/　/g, ' ')
    .trim();

  let totalMinutes = -1;
  let seconds = -1;

  // 1. Japanese "3分45秒" or "3分" or "45秒"
  const minSecMatch = trimmed.match(/^(?:(\d+)分)?\s*(?:(\d+)秒)?$/);
  if (minSecMatch && (minSecMatch[1] || minSecMatch[2])) {
    totalMinutes = parseInt(minSecMatch[1] || '0', 10);
    seconds = parseInt(minSecMatch[2] || '0', 10);
  } else if (trimmed.includes(':')) {
    // 2. Colon format: "3:45", "03:45", "1:00:00", "3:5"
    const parts = trimmed.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[0].trim()) && /^\d+$/.test(parts[1].trim())) {
      totalMinutes = parseInt(parts[0].trim(), 10);
      seconds = parseInt(parts[1].trim(), 10);
    } else if (
      parts.length === 3 &&
      /^\d+$/.test(parts[0].trim()) &&
      /^\d+$/.test(parts[1].trim()) &&
      /^\d+$/.test(parts[2].trim())
    ) {
      const hh = parseInt(parts[0].trim(), 10);
      const mm = parseInt(parts[1].trim(), 10);
      if (mm >= 60) {
        return {
          valid: false,
          normalized: '',
          error: `ありえない分数（${mm}分）です（60分以内で入力してください）`,
        };
      }
      totalMinutes = hh * 60 + mm;
      seconds = parseInt(parts[2].trim(), 10);
    } else {
      return {
        valid: false,
        normalized: '',
        error: '時間の形式が正しくありません（MM:SS または 4桁数字で入力してください）',
      };
    }
  } else {
    // 3. Pure digits e.g. "0345" -> 03:45, "345" -> 03:45, "45" -> 00:45
    const cleanSecSuffix = trimmed.replace(/[sS]$/, '');
    if (!/^\d+$/.test(cleanSecSuffix)) {
      return {
        valid: false,
        normalized: '',
        error: '時間の形式が正しくありません（MM:SS または 4桁数字で入力してください）',
      };
    }
    if (cleanSecSuffix.length === 4) {
      totalMinutes = parseInt(cleanSecSuffix.slice(0, 2), 10);
      seconds = parseInt(cleanSecSuffix.slice(2, 4), 10);
    } else if (cleanSecSuffix.length === 3) {
      totalMinutes = parseInt(cleanSecSuffix[0], 10);
      seconds = parseInt(cleanSecSuffix.slice(1, 3), 10);
    } else if (cleanSecSuffix.length === 1 || cleanSecSuffix.length === 2) {
      totalMinutes = 0;
      seconds = parseInt(cleanSecSuffix, 10);
    } else {
      return {
        valid: false,
        normalized: '',
        error: 'ありえない時間桁数です（60分以内・MM:SS形式で入力してください）',
      };
    }
  }

  if (totalMinutes > 60) {
    return {
      valid: false,
      normalized: '',
      error: `ありえない分数（${totalMinutes}分）です。60分以内で入力してください`,
    };
  }

  if (seconds < 0 || seconds >= 60) {
    return {
      valid: false,
      normalized: '',
      error: `ありえない秒数（${seconds}秒）です。00〜59秒の範囲で入力してください`,
    };
  }

  return {
    valid: true,
    normalized: `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  };
}

