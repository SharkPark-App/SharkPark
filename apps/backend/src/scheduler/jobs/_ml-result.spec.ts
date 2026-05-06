import { parseMlResult } from './_ml-result';

describe('parseMlResult', () => {
  it('returns null for empty input', () => {
    expect(parseMlResult('')).toBeNull();
  });

  it('returns null when the marker is absent', () => {
    expect(parseMlResult('Wrote 28 predictions\nDone.')).toBeNull();
  });

  it('parses a valid ML_RESULT JSON object', () => {
    const out = [
      'Loading production model: short-term v5',
      'Wrote 28 predictions to database (predictions_short_term)',
      'ML_RESULT: {"horizon": "short_term", "model_version": "v5", "predictions_written": 28}',
    ].join('\n');
    expect(parseMlResult(out)).toEqual({
      horizon: 'short_term',
      model_version: 'v5',
      predictions_written: 28,
    });
  });

  it('returns the LAST ML_RESULT line if multiple are present', () => {
    const out = [
      'ML_RESULT: {"version": 1}',
      'unrelated chatter',
      'ML_RESULT: {"version": 2}',
    ].join('\n');
    expect(parseMlResult(out)).toEqual({ version: 2 });
  });

  it('skips malformed JSON and falls back to an earlier valid line', () => {
    const out = [
      'ML_RESULT: {"good": true}',
      'ML_RESULT: not-json-at-all',
    ].join('\n');
    expect(parseMlResult(out)).toEqual({ good: true });
  });

  it('rejects non-object JSON values (arrays, primitives)', () => {
    expect(parseMlResult('ML_RESULT: [1,2,3]')).toBeNull();
    expect(parseMlResult('ML_RESULT: 42')).toBeNull();
    expect(parseMlResult('ML_RESULT: "string"')).toBeNull();
    expect(parseMlResult('ML_RESULT: null')).toBeNull();
  });

  it('handles a marker embedded mid-line (logger prefix etc.)', () => {
    const line =
      '2026-05-06T10:00:00Z [INFO] ML_RESULT: {"model_version": "v9"}';
    expect(parseMlResult(line)).toEqual({ model_version: 'v9' });
  });
});
