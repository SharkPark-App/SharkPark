/**
 * Format a time-of-day in the user's locale, respecting the device's
 * 12 / 24-hour preference (iOS Settings → General → Date & Time → 24-Hour Time;
 * Android Settings → System → Date & Time → Use 24-hour format).
 *
 * Passing `undefined` for the locale and omitting `hour12` lets the platform
 * pick both the language and the 12/24-hour convention from the OS.
 */
export function formatTime(value: Date | string): string {
  const date = value instanceof Date ? value : parseTimeOfDay(value);
  if (!date) return typeof value === 'string' ? value : '';
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a start – end window. Falls back to just the start when no end is
 * given, when the parsed end is invalid, or when start === end.
 */
export function formatTimeRange(
  start: Date,
  end?: Date | null,
): string {
  const startStr = formatTime(start);
  if (!end || Number.isNaN(end.getTime())) return startStr;
  if (end.getTime() <= start.getTime()) return startStr;
  return `${startStr} – ${formatTime(end)}`;
}

/**
 * Parse an `HH:MM` 24-hour string (e.g. `"09:00"`, `"23:59"`) into today's
 * Date so it can be formatted with the user's locale. Returns `null` for
 * unparseable input (e.g. `"CLOSED"`).
 */
function parseTimeOfDay(time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || h < 0 || h > 24 || min < 0 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}
