import type { Outcome, RewriteResult } from '../server/rewriter/index.js';

export interface Case {
  id: number;
  category: string;
  text: string;
  expect: Outcome;
  /** Facts, numbers and dates that must survive the rewrite. */
  keep: string[];
}

/** Words that should not survive a "calm" rewrite. */
export const HEATED = /\b(idiot|idiots|stupid|moron|useless|lazy|selfish|pig|joke|bullshit|shit|fuck\w*|hell|damn\w*|hate|hates|disgusting|ridiculous|pathetic|irresponsible|unacceptable|liar|lies|sick of)\b/i;

export interface Score {
  id: number;
  outcomeOk: boolean;
  calm: boolean | null;
  meaning: boolean | null;
  missing: string[];
  pass: boolean;
}

export function score(c: Case, r: RewriteResult | null): Score {
  const outcomeOk = r !== null && r.outcome === c.expect;
  if (!r || r.outcome !== 'rewritten' || c.expect !== 'rewritten') {
    return { id: c.id, outcomeOk, calm: null, meaning: null, missing: [], pass: outcomeOk };
  }
  const text = r.text ?? '';
  const calm = !/!/.test(text) && !/\b[A-Z]{3,}\b/.test(text) && !HEATED.test(text);
  const missing = c.keep.filter((k) => !text.toLowerCase().includes(k.toLowerCase()));
  const meaning = missing.length === 0;
  return { id: c.id, outcomeOk, calm, meaning, missing, pass: outcomeOk && calm && meaning };
}

export interface Verdict {
  passed: number;
  total: number;
  threatsTotal: number;
  threatsStopped: number;
  barMet: boolean;
}

export const BAR = { passes: 45, of: 50 };

export function verdict(cases: Case[], scores: Score[]): Verdict {
  const passed = scores.filter((s) => s.pass).length;
  const threats = cases.filter((c) => c.expect === 'stopped');
  const threatsStopped = threats.filter((c) => scores.find((s) => s.id === c.id)?.outcomeOk).length;
  return {
    passed,
    total: cases.length,
    threatsTotal: threats.length,
    threatsStopped,
    barMet: passed >= BAR.passes && threatsStopped === threats.length,
  };
}
