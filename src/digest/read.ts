// Run log reader (plan.md § 1): runs/<night>.jsonl -> Night.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Parses one non-blank line. Returns null when it is not JSON or not a RunLine. */
export function parseRunLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { at, job, status, owner, error } = value;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && error !== null && typeof error !== 'string') return null;
  return { at, job, status, owner, error: error ?? null };
}

function toRow(job: string, lines: RunLine[]): DigestRow {
  // Order by time (offsets respected), file order on ties. Strings are kept as written.
  const sorted = lines
    .map((line, i) => ({ line, i, t: Date.parse(line.at) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.line);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  let lastError: string | null = null;
  for (const line of sorted) {
    if (line.error !== null && line.error.trim() !== '') lastError = line.error;
  }
  return {
    job,
    owner: last.owner,
    runs: sorted.length,
    retries: sorted.filter((l) => l.status === 'retry').length,
    lastStatus: last.status,
    lastError,
    firstAt: first.at,
    lastAt: last.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    const code = isRecord(err) ? err.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }

  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, RunLine[]>();
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const line = parseRunLine(trimmed);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const list = byJob.get(line.job);
    if (list) list.push(line);
    else byJob.set(line.job, [line]);
  }

  const rows = [...byJob.entries()]
    .map(([job, lines]) => toRow(job, lines))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines, counts };
};
