/**
 * Parse an `ML_RESULT: { ... }` JSON marker line out of a Python predict
 * script's stdout tail.
 *
 * The ML predict scripts (`services/ml/scripts/predict_short_term.py` and
 * `predict_long_term.py`) print a single, well-formed JSON object on the
 * line preceded by `ML_RESULT: ` immediately before exit. The marker is
 * machine-readable on purpose — the rest of the script's output is human
 * log lines via `logger.info(...)` and is not stable.
 *
 * If the marker isn't present (older script version, mid-process kill,
 * truncated tail buffer), we return `null`. The caller should treat
 * absence as "no metadata captured" — never as an error — because the job
 * may have legitimately succeeded despite the missing marker, and we don't
 * want to fail a successful prediction tick because of an audit-channel
 * issue.
 *
 * Bounded by the 64KiB tail in `_ml-runner.ts`; we scan from the end so a
 * long stdout doesn't slow down parsing.
 */
export function parseMlResult(
  stdoutTail: string,
): Record<string, unknown> | null {
  if (!stdoutTail) return null;
  const lines = stdoutTail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const idx = line.indexOf('ML_RESULT:');
    if (idx === -1) continue;
    const jsonPart = line.slice(idx + 'ML_RESULT:'.length).trim();
    if (!jsonPart) continue;
    try {
      const parsed: unknown = JSON.parse(jsonPart);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
      // ML_RESULT: must be a JSON object — anything else is a bug in the
      // emitter; ignore and keep scanning earlier lines.
    } catch {
      // Malformed JSON — keep scanning. The script may have logged a
      // human-readable line that happens to contain "ML_RESULT:" earlier.
    }
  }
  return null;
}
