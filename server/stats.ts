import type { Db } from './db.js';

export interface Stats {
  conversations: Record<string, number>;
  usage: Record<string, number>;
  rewrites: { outcomes: Record<string, number>; avgMs: number; p95Ms: number; inputTokens: number; outputTokens: number };
}

const tally = (rows: { k: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.k, r.n]));

/** Counts only. Nothing in here can hold message text. */
export function collectStats(db: Db): Stats {
  const conversations = tally(db.prepare('SELECT status AS k, COUNT(*) AS n FROM conversations GROUP BY status').all() as { k: string; n: number }[]);
  const usage = tally(db.prepare('SELECT kind AS k, COUNT(*) AS n FROM usage_events GROUP BY kind').all() as { k: string; n: number }[]);
  const outcomes = tally(db.prepare('SELECT outcome AS k, COUNT(*) AS n FROM rewrite_events GROUP BY outcome').all() as { k: string; n: number }[]);
  const times = (db.prepare('SELECT latency_ms AS ms FROM rewrite_events ORDER BY latency_ms').all() as { ms: number }[]).map((r) => r.ms);
  const tokens = db.prepare('SELECT COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o FROM rewrite_events').get() as { i: number; o: number };
  return {
    conversations,
    usage,
    rewrites: {
      outcomes,
      avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      p95Ms: times.length ? times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] : 0,
      inputTokens: tokens.i,
      outputTokens: tokens.o,
    },
  };
}

export function formatStats(s: Stats): string {
  const line = (title: string, counts: Record<string, number>) =>
    `${title}: ${Object.keys(counts).length ? Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ') : 'none yet'}`;
  return [
    line('Conversations', s.conversations),
    line('What people did', s.usage),
    line('Rewrite results', s.rewrites.outcomes),
    `Rewrite time: average ${s.rewrites.avgMs} ms, slowest 5% over ${s.rewrites.p95Ms} ms`,
    `Tokens used: ${s.rewrites.inputTokens} in, ${s.rewrites.outputTokens} out`,
  ].join('\n');
}
