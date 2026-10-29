// Types for the morning digest (plan.md § 1). Types only: the reader implements ReadNight.

/** Status of one line in runs/<night>.jsonl. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One parsed line of runs/<night>.jsonl. */
export type RunLine = {
  /** ISO 8601 time exactly as in the log, offset kept (e.g. "2026-10-28T01:00:04+01:00"). */
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  /** Absent in the log means null. */
  error: string | null;
};

/** One row per job for the night. */
export type DigestRow = {
  job: string;
  /** Owner from the job's last line. null renders as "—". */
  owner: string | null;
  /** Number of lines for this job (every status). */
  runs: number;
  /** Number of lines for this job with status "retry". */
  retries: number;
  /** Status of the job's last line. */
  lastStatus: RunStatus;
  /** Most recent non-empty error for this job, or null if none. Renders as "—". */
  lastError: string | null;
  /** Earliest `at`, as written in the log (offset kept, never converted to UTC). */
  firstAt: string;
  /** Latest `at`, as written in the log (offset kept, never converted to UTC). */
  lastAt: string;
};

/** Number of parsed lines per status, for the board's ok / retry / fail counts. */
export type StatusCounts = Record<RunStatus, number>;

/** A night whose file exists. An empty file gives `rows: []` ("nothing ran"). */
export type Night = {
  /** "YYYY-MM-DD", the file name without ".jsonl". */
  night: string;
  /** One row per job, sorted by job. Page and JSON use this order as is. */
  rows: DigestRow[];
  /** Lines that did not parse or did not match RunLine. Counted, never thrown. Blank lines are not counted. */
  badLines: number;
  counts: StatusCounts;
};

/**
 * Reads `<runsDir>/<night>.jsonl`.
 * Returns null when there is no file for that night (the routes answer 404).
 * Never throws on bad lines: they are counted in `badLines`.
 */
export type ReadNight = (runsDir: string, night: string) => Night | null;
