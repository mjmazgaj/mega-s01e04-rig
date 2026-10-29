import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const line = (at: string, job: string, status: string, owner?: string, error?: string) =>
  JSON.stringify({ at, job, status, ...(owner ? { owner } : {}), ...(error ? { error } : {}) });

// Written out of job order on purpose: rows must come back sorted by job.
const DATA = [
  line('2026-10-28T01:00:04+01:00', 'zeta-sync', 'ok', 'ania'),
  line('2026-10-28T01:05:00+01:00', 'alpha-backup', 'retry', undefined, 'timeout'),
  line('2026-10-28T01:06:00+01:00', 'alpha-backup', 'fail', undefined, 'disk full'),
  line('2026-10-28T01:07:00+01:00', 'mid-report', 'ok', 'bartek'),
].join('\n');

let runsDir: string;
const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), DATA + '\n');
  writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-10-26.jsonl'),
    [line('2026-10-26T02:00:00+01:00', 'only-job', 'ok', 'ania'), 'not json {'].join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders a night with data: one table, rows sorted by job, missing values as a dash', async () => {
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    const order = ['alpha-backup', 'mid-report', 'zeta-sync'].map((j) => html.indexOf(j));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('—');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('answers 404 when the night is not YYYY-MM-DD', async () => {
    const res = await app().request('/digest/tonight');
    expect(res.status).toBe(404);
  });

  it('renders "nothing ran" for an empty night', async () => {
    const res = await app().request('/digest/2026-10-27');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still answers 200 for a night with a bad line', async () => {
    const res = await app().request('/digest/2026-10-26');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('only-job');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night for a night with data, rows sorted by job', async () => {
    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe('2026-10-28');
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(['alpha-backup', 'mid-report', 'zeta-sync']);
    expect(night.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app().request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
  });

  it('returns no rows for an empty night', async () => {
    const res = await app().request('/api/digest/2026-10-27');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(0);
  });

  it('counts a bad line and still answers 200', async () => {
    const res = await app().request('/api/digest/2026-10-26');
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['only-job']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app().request('/digest/2026-10-28')).text();
    const night = (await (await app().request('/api/digest/2026-10-28')).json()) as Night;
    const positions = night.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
