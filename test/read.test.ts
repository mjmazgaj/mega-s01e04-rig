import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads 5 jobs and 1 bad line (the truncated last line)', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows).toHaveLength(5);
    expect(night!.badLines).toBe(1);
  });

  it('sorts rows by job', () => {
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps a row with a null owner', () => {
    expect(row('digest/render')).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('counts retries and keeps the last error even after an ok', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('reports a failed job with its error', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('keeps times exactly as written, offset included', () => {
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('counts parsed lines per status', () => {
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (night: string, text: string) => writeFileSync(join(dir, `${night}.jsonl`), text);

  it('returns null when the night has no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
    expect(readNight(join(dir, 'missing'), '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight(dir, '../runs/2026-10-28')).toBeNull();
  });

  it('gives rows [] for an empty file', () => {
    write('2026-02-01', '');
    expect(readNight(dir, '2026-02-01')).toEqual({
      night: '2026-02-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts bad lines, skips blank ones, never throws', () => {
    write(
      '2026-02-02',
      [
        '',
        'not json',
        '[1,2]',
        'null',
        '{"at":"2026-02-02T01:00:00+02:00","job":"a","status":"weird","owner":"x"}',
        '{"at":"nope","job":"a","status":"ok","owner":"x"}',
        '{"at":"2026-02-02T01:00:00+02:00","job":"a","status":"ok"}',
        '{"at":"2026-02-02T01:00:00+02:00","job":"a","status":"ok","owner":5}',
        '{"at":"2026-02-02T01:00:00+02:00","job":"a","status":"ok","owner":"x","error":3}',
        '   ',
        '{"at":"2026-02-02T01:00:00+02:00","job":"a","status":"ok","owner":"x"}',
        '',
      ].join('\r\n'),
    );
    const night = readNight(dir, '2026-02-02');
    expect(night!.badLines).toBe(8);
    expect(night!.rows).toHaveLength(1);
    expect(night!.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('uses the last line by time for owner and status, and the most recent non-empty error', () => {
    write(
      '2026-02-03',
      [
        '{"at":"2026-02-03T02:00:00+01:00","job":"b","status":"retry","owner":"old","error":"first"}',
        '{"at":"2026-02-03T03:00:00+01:00","job":"b","status":"retry","owner":"old","error":"second"}',
        '{"at":"2026-02-03T04:00:00+01:00","job":"b","status":"ok","owner":"new","error":""}',
        '{"at":"2026-02-03T00:30:00Z","job":"b","status":"ok","owner":"early"}',
      ].join('\n'),
    );
    expect(readNight(dir, '2026-02-03')!.rows[0]).toEqual({
      job: 'b',
      owner: 'new',
      runs: 4,
      retries: 2,
      lastStatus: 'ok',
      lastError: 'second',
      firstAt: '2026-02-03T00:30:00Z',
      lastAt: '2026-02-03T04:00:00+01:00',
    });
  });
});
