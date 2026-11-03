import { Writable } from 'node:stream';
import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { FakeRewriter } from '../server/rewriter/fake.js';

// Load test for the plumbing: real HTTP, an in-memory database and the fake rewriter.
// It says nothing about a real AI provider, whose speed and limits will matter more.
// Usage: npm run load-test -- [pairs] [messages per person]
const pairs = Number(process.argv[2] ?? 50);
const perPerson = Number(process.argv[3] ?? 5);

const config = {
  ...loadConfig({ REWRITER: 'fake' }),
  webDir: 'does-not-exist',
  rateCreatePerHour: 1e9,
  rateJoinPerHour: 1e9,
  rateDraftPerMinute: 1e9,
  dailyRewriteCap: 1e9,
};
const { app } = buildApp({ config, db: openDb(':memory:'), rewriter: new FakeRewriter(), logStream: new Writable({ write: (_c, _e, done) => done() }) });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

const times: number[] = [];
let failures = 0;
let delivered = 0;

async function call(method: string, path: string, token?: string, body?: object) {
  const started = performance.now();
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  times.push(performance.now() - started);
  if (!res.ok) failures++;
  return res.ok ? ((await res.json().catch(() => ({}))) as any) : {};
}

/** Holds a live stream open and counts the "message" events that arrive. Resolves once connected. */
async function listen(id: string, token: string, controller: AbortController) {
  const res = await fetch(`${base}/api/conversations/${id}/events?t=${token}`, { signal: controller.signal });
  void (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Events can be split across network chunks, so count complete ones only.
      buffered += decoder.decode(value, { stream: true });
      const events = buffered.split('\n\n');
      buffered = events.pop() ?? '';
      delivered += events.filter((e) => e.startsWith('event: message')).length;
    }
  })().catch(() => {});
}

async function onePair(n: number, controller: AbortController) {
  const a = await call('POST', '/api/conversations', undefined, { name: `Alex${n}`, topic: 'Who pays for the lamp' });
  const s = await call('POST', `/api/invites/${a.inviteToken}/join`, undefined, { name: `Sam${n}`, adult: true, consent: true });
  if (!a.id || !s.participantToken) return;
  await Promise.all([listen(a.id, a.participantToken, controller), listen(a.id, s.participantToken, controller)]);
  for (let i = 0; i < perPerson; i++) {
    for (const token of [a.participantToken, s.participantToken]) {
      const d = await call('POST', `/api/conversations/${a.id}/drafts`, token, { text: `You never answer me, this is ridiculous. Please reply about item ${i} by Friday.` });
      if (d.draft?.id) await call('POST', `/api/drafts/${d.draft.id}/send`, token);
    }
  }
  await call('POST', `/api/conversations/${a.id}/close`, a.participantToken);
}

const controller = new AbortController();
const started = performance.now();
await Promise.all(Array.from({ length: pairs }, (_, n) => onePair(n, controller)));
const seconds = (performance.now() - started) / 1000;
// Give the last live events a moment to arrive before closing the streams.
for (let i = 0; i < 100 && delivered < pairs * perPerson * 4; i++) await new Promise((r) => setTimeout(r, 100));
controller.abort();

times.sort((x, y) => x - y);
const pct = (p: number) => times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)].toFixed(1);
console.log(`${pairs} pairs, ${perPerson} messages each, all at once`);
console.log(`${times.length} requests in ${seconds.toFixed(1)} s (${Math.round(times.length / seconds)} per second)`);
console.log(`Request time: median ${pct(0.5)} ms, 95% under ${pct(0.95)} ms, slowest ${times[times.length - 1].toFixed(1)} ms`);
console.log(`Failed requests: ${failures}`);
console.log(`Live messages delivered: ${delivered} of ${pairs * perPerson * 2 * 2} expected`);
await app.close();
process.exit(failures || delivered < pairs * perPerson * 4 ? 1 : 0);
