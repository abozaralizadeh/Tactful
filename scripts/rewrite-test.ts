/**
 * Runs the 50 heated messages through the configured rewriter and writes a sheet to score by hand.
 *
 *   npm run rewrite-test            uses REWRITER from .env (fake by default, free)
 *   npm run rewrite-test -- --strict   exits 1 if the bar is not met
 *
 * With REWRITER=anthropic this makes 50 paid calls, so it only runs when you set that yourself.
 */
import fs from 'node:fs';
import { loadConfig } from '../server/config.js';
import { createRewriter, type RewriteResult } from '../server/rewriter/index.js';
import { BAR, score, verdict, type Case } from './score.js';

const config = loadConfig();
const rewriter = createRewriter(config);
const cases = JSON.parse(fs.readFileSync('data/heated-messages.json', 'utf8')) as Case[];

const results: (RewriteResult | null)[] = [];
let ms = 0;
for (const c of cases) {
  const started = Date.now();
  try {
    results.push(await rewriter.rewrite({ original: c.text, topic: 'Test conversation', recent: [] }));
  } catch (err) {
    console.error(`case ${c.id} failed: ${(err as Error).message}`);
    results.push(null);
  }
  ms += Date.now() - started;
}

const scores = cases.map((c, i) => score(c, results[i]));
const v = verdict(cases, scores);
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
const mark = (b: boolean | null) => (b === null ? '-' : b ? 'yes' : 'NO');

const lines = [
  '# Rewrite test',
  '',
  `Provider: **${rewriter.name}**. Average time per message: ${Math.round(ms / cases.length)} ms.`,
  '',
  rewriter.name === 'fake'
    ? '> The fake rewriter is a set of simple local rules. These numbers only show the harness works. They say nothing about how well a real AI rewrites. Run again with a real provider, then fill in the two "you" columns by hand.'
    : '> Automatic checks are rough (banned words, kept facts). Read every rewrite yourself and fill in the "you" columns.',
  '',
  `**Automatic result: ${v.passed} of ${v.total} passed. Threats and danger stopped: ${v.threatsStopped} of ${v.threatsTotal}.**`,
  `Bar: ${BAR.passes} of ${BAR.of} pass and every threat stopped. ${v.barMet ? 'Met.' : 'Not met.'}`,
  '',
  '| # | Kind | Original | Expected | Got | Rewrite or note | Auto | Calm (you) | Meaning (you) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...cases.map((c, i) => {
    const r = results[i];
    const s = scores[i];
    const note = r === null ? 'ERROR' : r.outcome === 'rewritten' ? r.text : (r.reason ?? '');
    const auto = s.pass ? 'pass' : `FAIL${s.missing.length ? ` (lost: ${s.missing.join(', ')})` : ''}${s.calm === false ? ' (not calm)' : ''}`;
    return `| ${c.id} | ${c.category} | ${cell(c.text)} | ${c.expect} | ${r?.outcome ?? 'error'} | ${cell(note ?? '')} | ${auto} | | |`;
  }),
  '',
];
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/rewrite-test.md', lines.join('\n'));

console.log(`provider: ${rewriter.name}`);
console.log(`passed ${v.passed}/${v.total}, threats stopped ${v.threatsStopped}/${v.threatsTotal}, bar ${v.barMet ? 'met' : 'NOT met'}`);
for (const s of scores.filter((s) => !s.pass)) {
  const c = cases.find((x) => x.id === s.id)!;
  console.log(`  FAIL #${s.id} (${c.category}): expected ${c.expect}, ${results[s.id - 1]?.outcome ?? 'error'}${s.missing.length ? `, lost ${s.missing.join('/')}` : ''}${s.calm === false ? ', not calm' : ''}`);
}
console.log('sheet written to reports/rewrite-test.md');
if (process.argv.includes('--strict') && !v.barMet) process.exit(1);
